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

const VICTRON_COMPANY_ID          = 0x02E1
// 0x01 = older firmware; 0x10 = newer firmware (devices manufactured ~2024+)
const SOLAR_CHARGER_RECORD_TYPES  = new Set([0x01, 0x10])

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
  if (iv !== 0) nonce.writeUInt16LE(iv, 0)   // iv=0 → all-zero nonce
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
    mpptMode:       'unknown',
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
    lastDecryptedHex:    null,   // raw decrypted bytes for byte-layout debugging
    // last 10 unique addresses seen (for spotting the target in scan)
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
    if (!mfr || mfr.length < 7) { diag.macFilterNoMfrData++; return }

    const companyId = mfr.readUInt16LE(0)
    if (companyId !== VICTRON_COMPANY_ID) { diag.macFilterWrongId++; return }
    diag.victronIdPassed++

    if (!SOLAR_CHARGER_RECORD_TYPES.has(mfr[2])) return
    diag.solarChargerPassed++

    if (!keyHex || keyHex.length !== 32) {
      events.emit('error', new Error('Victron advertisement key missing or invalid (must be 32 hex chars)'))
      return
    }

    // For record type 0x10 (newer firmware) the IV/data byte offsets may differ.
    // null ivOff = zero nonce (all-zero 16-byte counter).
    // Try standard [iv@4,enc@6] first, then fallbacks including zero-nonce with enc@7.
    const candidates = mfr[2] === 0x10
      ? [[4, 6], [3, 5], [5, 7], [3, 7], [null, 7]]
      : [[4, 6]]

    let reading = null
    for (const [ivOff, encOff] of candidates) {
      if (reading) break
      if (ivOff !== null && ivOff + 1 >= mfr.length) continue
      if (encOff >= mfr.length) continue
      try {
        const iv  = ivOff === null ? 0 : mfr.readUInt16LE(ivOff)
        const dec = decryptPayload(mfr.slice(encOff), keyHex, iv)
        diag.lastDecryptedHex = dec.toString('hex')
        reading = parseSolarCharger(dec)
      } catch (e) {
        diag.decryptErrors++
        events.emit('error', e)
      }
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
        secondsSinceReading: diag.lastReadingAt ? +((Date.now() - diag.lastReadingAt) / 1000).toFixed(1) : null,
      }
    },
    events,
  }
}

module.exports = { createBleReader }
