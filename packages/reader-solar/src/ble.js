/**
 * Camper Monitor — reader-solar/ble.js
 * Victron SmartSolar BLE reader — passive Instant Readout advertisement scanner.
 *
 * © 2026 Kai Steuernagel
 */

'use strict'

// Victron SmartSolar BLE reader — Instant Readout (passive advertisement scanning)
// Requires the per-device advertisement key from VictronConnect app.
//
// Note: PV voltage and PV current are NOT available in BLE advertisements;
//       pvVoltage and pvCurrent are emitted as null. Use VE.Direct for full data.

const { EventEmitter } = require('events')
const crypto           = require('crypto')

const VICTRON_COMPANY_ID    = 0x02E1
const RECORD_MARKER         = 0x10   // mfr[2]: identifies a Victron Instant Readout ad
const SOLAR_CHARGER_TYPE    = 0x01   // mfr[6]: record type for solar charger

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

// IV is mfr[7:8] LE, zero-padded to 16 bytes. Ciphertext starts at mfr[10].
// Spec: https://communityarchive.victronenergy.com/storage/attachments/extra-manufacturer-data-2022-12-14.pdf
function decryptMfr(mfr, keyHex) {
  const key   = Buffer.from(keyHex, 'hex')
  const nonce = Buffer.alloc(16)
  nonce.writeUInt16LE(mfr.readUInt16LE(7), 0)   // IV_lo=mfr[7], IV_hi=mfr[8]
  const cipher = crypto.createDecipheriv('aes-128-ctr', key, nonce)
  return Buffer.concat([cipher.update(mfr.slice(10)), cipher.final()])
}

function parseSolarCharger(decrypted) {
  if (decrypted.length < 10) return null
  const cs         = decrypted[0]
  const battV      = decrypted.readUInt16LE(2) / 100   // 10 mV → V
  const battI      = decrypted.readInt16LE(4) / 10     // 100 mA → A
  const yieldToday = decrypted.readUInt16LE(6) / 100   // 10 Wh → kWh
  const pvPower    = decrypted.readUInt16LE(8)          // W

  // Sanity check — wrong key produces garbage that passes length check
  if (battV < 0 || battV > 80)       return null   // 0-80 V covers all Victron battery systems
  if (Math.abs(battI) > 200)         return null   // SmartSolar max output is 100 A
  if (pvPower > 10000)               return null   // generous upper bound for BLE-connected chargers
  if (yieldToday > 100)              return null   // 100 kWh/day is unreachable

  return {
    pvVoltage:      null,   // not in BLE advertisement
    pvPower,
    pvCurrent:      null,   // not derivable without pvVoltage
    batteryCurrent: +battI.toFixed(2),
    batteryVoltage: +battV.toFixed(2),
    mode:           CS_MODES[cs] ?? 'Unknown',
    mpptMode:       null,   // not available in BLE advertisements (VE.Direct only)
    yieldToday:     +yieldToday.toFixed(2),
    ts:             Date.now(),
  }
}

function createBleReader(config) {
  const events = new EventEmitter()
  const macRaw = (config.macAddress ?? '').toLowerCase()
  const mac    = macRaw.replace(/:/g, '')
  const keyHex = (config.advertisementKey ?? '').replace(/\s/g, '')
  let noble    = null
  let running  = false

  const diag = {
    nobleState:          'unknown',
    scanStartedAt:       null,
    advertisementsTotal: 0,
    macFilterPassed:     0,
    macFilterNoMfrData:  0,
    macFilterWrongId:    0,
    lastMacMatch:        null,
    victronIdPassed:     0,
    solarChargerPassed:  0,
    decryptErrors:       0,
    parseErrors:         0,
    readingsTotal:       0,
    lastReadingAt:       null,
    lastReading:         null,
    lastDecryptedHex:    null,
    // last 100 unique addresses seen (for spotting the target in scan)
    recentDevices:       [],
    devicesSeenTotal:    0,   // total unique addresses ever seen (never decrements)
  }

  function noteDevice(peripheral) {
    const addr = (peripheral.address ?? 'unknown').toLowerCase()
    const name = peripheral.advertisement?.localName ?? ''
    const existing = diag.recentDevices.find(d => d.address === addr)
    if (existing) {
      existing.ts = Date.now()
    } else {
      diag.devicesSeenTotal++
      diag.recentDevices.push({ address: addr, name, ts: Date.now() })
      if (diag.recentDevices.length > 100) diag.recentDevices.shift()
    }
  }

  function onDiscover(peripheral) {
    diag.advertisementsTotal++
    noteDevice(peripheral)

    const addr = (peripheral.address ?? '').toLowerCase().replace(/:/g, '')
    if (mac && addr !== mac) return
    diag.macFilterPassed++

    const mfr = peripheral.advertisement?.manufacturerData
    diag.lastMacMatch = {
      ts:               Date.now(),
      hasMfrData:       !!(mfr && mfr.length >= 2),
      mfrHex:           mfr?.toString('hex') ?? null,
      companyId:        (mfr?.length >= 2) ? `0x${mfr.readUInt16LE(0).toString(16).padStart(4, '0')}` : null,
      expectedCompanyId: `0x${VICTRON_COMPANY_ID.toString(16).padStart(4, '0')}`,
    }
    if (!mfr || mfr.length < 22) { diag.macFilterNoMfrData++; return }

    const companyId = mfr.readUInt16LE(0)
    if (companyId !== VICTRON_COMPANY_ID) { diag.macFilterWrongId++; return }
    diag.victronIdPassed++

    if (mfr[2] !== RECORD_MARKER || mfr[6] !== SOLAR_CHARGER_TYPE) return
    diag.solarChargerPassed++

    if (!keyHex || keyHex.length !== 32) {
      events.emit('error', new Error('Victron advertisement key missing or invalid (must be 32 hex chars)'))
      return
    }

    // mfr[9] = key[0] transmitted unencrypted — mismatch means wrong key or key has changed
    const keyBuf = Buffer.from(keyHex, 'hex')
    if (mfr[9] !== keyBuf[0]) {
      diag.parseErrors++
      diag.lastDecryptedHex = null
      events.emit('error', new Error(`Key check failed: advertisement key may have changed (expected 0x${keyBuf[0].toString(16)}, got 0x${mfr[9].toString(16)})`))
      return
    }

    let reading = null
    try {
      const dec = decryptMfr(mfr, keyHex)
      diag.lastDecryptedHex = dec.toString('hex')
      reading = parseSolarCharger(dec)
    } catch (e) {
      diag.decryptErrors++
      events.emit('error', e)
    }

    if (reading) {
      diag.readingsTotal++
      diag.lastReadingAt = Date.now()
      diag.lastReading   = reading
      if (!everConnected) { everConnected = true; events.emit('connected') }
      events.emit('data', reading)
    } else {
      diag.parseErrors++
    }
  }

  let nobleReady     = false
  let everConnected  = false   // emit 'connected' once on first Victron advertisement

  return {
    start() {
      running = true
      try { noble = require('@abandonware/noble') }
      catch (err) {
        if (err.code === 'MODULE_NOT_FOUND') {
          events.emit('error', new Error('BLE driver requires @abandonware/noble — run: npm install @abandonware/noble'))
          return
        }
        // Bluetooth adapter not ready yet (common on boot) — retry
        if (running) setTimeout(() => this.start(), 5000)
        return
      }

      if (!nobleReady) {
        nobleReady = true
        noble.on('stateChange', state => {
          diag.nobleState = state
          if (state === 'poweredOn') {
            diag.scanStartedAt = Date.now()
            noble.startScanning([], true)   // allow duplicates for continuous updates
          }
        })
        noble.on('discover', onDiscover)
      }
      if (noble.state === 'poweredOn') {
        diag.nobleState    = noble.state
        diag.scanStartedAt = Date.now()
        noble.startScanning([], true)
      }
    },
    stop() {
      running = false
      noble?.stopScanning()
      events.emit('disconnected')
    },
    diagnostics() {
      return {
        driver:              'ble',
        nobleState:          diag.nobleState,
        targetMac:           macRaw || '(any Victron)',
        keyConfigured:       keyHex.length === 32,
        deviceFound:         diag.macFilterPassed > 0,
        scanStartedAt:       diag.scanStartedAt,
        recentDevices:       diag.recentDevices,
        devicesSeenTotal:    diag.devicesSeenTotal,
        advertisementsTotal: diag.advertisementsTotal,
        macFilterPassed:     diag.macFilterPassed,
        macFilterNoMfrData:  diag.macFilterNoMfrData,
        macFilterWrongId:    diag.macFilterWrongId,
        lastMacMatch:        diag.lastMacMatch,
        victronIdPassed:     diag.victronIdPassed,
        solarChargerPassed:  diag.solarChargerPassed,
        decryptErrors:       diag.decryptErrors,
        parseErrors:         diag.parseErrors,
        readingsTotal:       diag.readingsTotal,
        lastReadingAt:       diag.lastReadingAt,
        lastReading:         diag.lastReading,
        lastDecryptedHex:    diag.lastDecryptedHex,
        secondsSinceReading:    diag.lastReadingAt ? +((Date.now() - diag.lastReadingAt) / 1000).toFixed(1) : null,
      }
    },
    events,
  }
}

module.exports = { createBleReader }
