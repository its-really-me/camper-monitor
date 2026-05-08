'use strict'

// Victron SmartSolar BLE reader — Instant Readout (passive advertisement scanning)
// Requires the per-device advertisement key from VictronConnect app.
//
// Note: PV voltage and PV current are NOT available in BLE advertisements;
//       pvVoltage and pvCurrent are emitted as null. Use VE.Direct for full data.

const { EventEmitter } = require('events')
const crypto           = require('crypto')

const VICTRON_COMPANY_ID          = 0x02E1
const RECORD_TYPE_SOLAR_CHARGER   = 0x01

const CS_MODES = {
  0:   'Off',
  2:   'Fault',
  3:   'Bulk',
  4:   'Absorption',
  5:   'Float',
  7:   'Equalize',
  245: 'Starting Up',
  247: 'Auto Equalize',
  252: 'External Control',
}

function decryptPayload(encrypted, keyHex, iv) {
  const nonce = Buffer.alloc(16)
  nonce.writeUInt16LE(iv, 0)        // 2-byte IV at start, remaining 14 bytes = 0
  const key     = Buffer.from(keyHex, 'hex')
  const cipher  = crypto.createDecipheriv('aes-128-ctr', key, nonce)
  return Buffer.concat([cipher.update(encrypted), cipher.final()])
}

function parseSolarCharger(decrypted) {
  if (decrypted.length < 10) return null
  const cs         = decrypted[0]
  const battV      = decrypted.readUInt16LE(2) / 100   // 10 mV → V
  const battI      = decrypted.readInt16LE(4) / 10     // 100 mA → A
  const yieldToday = decrypted.readUInt16LE(6) / 100   // 10 Wh → kWh
  const pvPower    = decrypted.readUInt16LE(8)          // W

  return {
    pvVoltage:      null,   // not in BLE advertisement
    pvPower,
    pvCurrent:      null,   // not derivable without pvVoltage
    batteryCurrent: +battI.toFixed(2),
    batteryVoltage: +battV.toFixed(2),
    mode:           CS_MODES[cs] ?? 'Unknown',
    mpptMode:       'unknown',
    yieldToday:     +yieldToday.toFixed(2),
    ts:             Date.now(),
  }
}

function createBleReader(config) {
  const events = new EventEmitter()
  const mac    = (config.macAddress ?? '').toLowerCase().replace(/:/g, '')
  const keyHex = (config.advertisementKey ?? '').replace(/\s/g, '')
  let noble    = null
  let running  = false

  function onDiscover(peripheral) {
    const addr = (peripheral.address ?? '').toLowerCase().replace(/:/g, '')
    if (mac && addr !== mac) return

    const mfr = peripheral.advertisement?.manufacturerData
    if (!mfr || mfr.length < 7) return

    const companyId = mfr.readUInt16LE(0)
    if (companyId !== VICTRON_COMPANY_ID) return
    if (mfr[2] !== RECORD_TYPE_SOLAR_CHARGER) return

    if (!keyHex || keyHex.length !== 32) {
      events.emit('error', new Error('Victron advertisement key missing or invalid (must be 32 hex chars)'))
      return
    }

    const iv        = mfr.readUInt16LE(4)
    const encrypted = mfr.slice(6)
    try {
      const decrypted = decryptPayload(encrypted, keyHex, iv)
      const reading   = parseSolarCharger(decrypted)
      if (reading) events.emit('data', reading)
    } catch (e) {
      events.emit('error', e)
    }
  }

  return {
    start() {
      running = true
      try { noble = require('@abandonware/noble') }
      catch { throw new Error('BLE driver requires @abandonware/noble — run: npm install @abandonware/noble') }

      noble.on('stateChange', state => {
        if (state === 'poweredOn') {
          events.emit('connected')
          noble.startScanning([], true)   // allow duplicates for continuous updates
        }
      })
      noble.on('discover', onDiscover)
      if (noble.state === 'poweredOn') {
        events.emit('connected')
        noble.startScanning([], true)
      }
    },
    stop() {
      running = false
      noble?.stopScanning()
      events.emit('disconnected')
    },
    events,
  }
}

module.exports = { createBleReader }
