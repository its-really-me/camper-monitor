/**
 * Camper Monitor — reader-starter/ble.js
 * intAct Battery-Guard / BM6 BLE driver — AES-128-CBC encrypted GATT notifications.
 *
 * © 2026 Kai Steuernagel
 */

'use strict'

// BM6 / intAct Battery-Guard BLE reader
// Protocol: tarball.ca/posts/reverse-engineering-the-bm6-ble-battery-monitor/
// Service:  0000fff0-0000-1000-8000-00805f9b34fb
// Write:    0000fff3-0000-1000-8000-00805f9b34fb  (send handshake)
// Notify:   0000fff4-0000-1000-8000-00805f9b34fb  (receive encrypted readings)
// Cipher:   AES-128-CBC, static key, zero IV — no per-device pairing needed

const { EventEmitter } = require('events')
const crypto           = require('crypto')

const SERVICE_UUID = 'fff0'
const WRITE_UUID   = 'fff3'
const NOTIFY_UUID  = 'fff4'

const KEY = Buffer.from('6c656167656e64fffe303130303030 39'.replace(/\s/g, ''), 'hex')
const IV  = Buffer.alloc(16, 0)

// Handshake: encrypt d1 55 07 00 + 12 zero bytes and write to the device
const HANDSHAKE = (() => {
  const plain  = Buffer.from([0xd1, 0x55, 0x07, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  const cipher = crypto.createCipheriv('aes-128-cbc', KEY, IV)
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(plain), cipher.final()])
})()

function decrypt(buf) {
  const decipher = crypto.createDecipheriv('aes-128-cbc', KEY, IV)
  decipher.setAutoPadding(false)
  return Buffer.concat([decipher.update(buf), decipher.final()])
}

function parsePayload(buf) {
  if (buf.length < 16) return null
  let d
  try { d = decrypt(buf.slice(0, 16)) } catch { return null }

  // Decrypted frame: d1 55 [type] 00 [data...]
  // Bytes 0-3 are the protocol header echoed from the handshake — not sensor data.
  if (d[0] !== 0xd1 || d[1] !== 0x55) return null

  // Bytes 7-8: voltage as BE uint16 × 0.01 V
  const voltage = d.readUInt16BE(7) / 100
  if (voltage < 2.5 || voltage > 20) return null   // sanity: reject garbage frames

  // Byte 6: SoC as integer percentage (device's own tracking, not OCV table)
  const soc = d[6]

  // Bytes 4-5: temperature — byte[4] = integer °C, byte[5] = tenths °C
  const rawTemp   = d[4] + d[5] / 10
  const temperature = (rawTemp > -40 && rawTemp < 80) ? +rawTemp.toFixed(1) : null

  const charging = voltage > 13.2
  const status   = charging ? 'charging' : 'idle'

  return {
    voltage:     +voltage.toFixed(2),
    temperature,
    soc,
    current:     null,
    power:       null,
    status,
    ts:          Date.now(),
  }
}

function createBleReader(config) {
  const events    = new EventEmitter()
  const mac       = (config.macAddress ?? '').toLowerCase()
  const interval  = config.pollInterval ?? 5000
  let noble       = null
  let peripheral  = null
  let writeChar   = null
  let pollTimer   = null
  let reconnTimer = null
  let running     = false
  let nobleReady  = false
  let connecting  = false

  const diag = {
    nobleState:           'unknown',
    scanStartedAt:        null,
    devicesSeenInScan:    [],
    devicesSeenTotal:     0,
    lastMatchAt:          null,
    connectAttempts:      0,
    connectingAt:         null,
    connectedAt:          null,
    disconnectedAt:       null,
    reconnectScheduledAt: null,
    lastRxAt:             null,
    rxBytesTotal:         0,
    parseOk:              0,
    parseErrors:          0,
    lastReadingAt:        null,
    lastReading:          null,
    lastRawHex:           null,   // raw notification bytes for protocol debugging
    lastDecryptedHex:     null,   // decrypted bytes for voltage offset debugging
  }

  function noteDevice(p) {
    const addr = (p.address ?? 'unknown').toLowerCase()
    const name = p.advertisement?.localName ?? ''
    const existing = diag.devicesSeenInScan.find(d => d.address === addr)
    if (existing) { existing.ts = Date.now() }
    else {
      diag.devicesSeenTotal++
      diag.devicesSeenInScan.push({ address: addr, name, ts: Date.now() })
      if (diag.devicesSeenInScan.length > 100) diag.devicesSeenInScan.shift()
    }
  }

  function matchDevice(p) {
    noteDevice(p)
    if (mac && p.address.toLowerCase().replace(/:/g, '') === mac.replace(/:/g, '')) return true
    const name = (p.advertisement?.localName ?? '').toLowerCase()
    return name.includes('bm6') || name.includes('battery guard') || name.includes('batteryguard')
  }

  function sendHandshake() {
    writeChar?.write(HANDSHAKE, false, err => {
      if (err) events.emit('error', new Error(`BM6 handshake: ${err.message}`))
    })
  }

  function onData(chunk) {
    diag.lastRxAt      = Date.now()
    diag.rxBytesTotal += chunk.length
    diag.lastRawHex    = chunk.toString('hex')
    if (chunk.length >= 16) {
      try { diag.lastDecryptedHex = decrypt(chunk.slice(0, 16)).toString('hex') } catch {}
    }
    const reading = parsePayload(chunk)
    if (reading) {
      diag.parseOk++
      diag.lastReadingAt = Date.now()
      diag.lastReading   = reading
      events.emit('data', reading)
    } else {
      diag.parseErrors++
    }
  }

  function connect(p) {
    if (connecting) return   // discover fires multiple times before stopScanning takes effect
    connecting = true
    diag.connectAttempts++
    diag.connectingAt = Date.now()
    peripheral = p
    p.removeAllListeners('disconnect')

    // Abort if connect/GATT discovery hangs (device moved away after advertising)
    let connectTimer = setTimeout(() => {
      if (!connecting) return
      connecting = false
      diag.connectingAt = null
      p.disconnect()
      scheduleReconnect()
    }, 20000)

    p.connect(err => {
      if (err) { clearTimeout(connectTimer); connecting = false; diag.connectingAt = null; return scheduleReconnect() }
      p.discoverServices([SERVICE_UUID], (err, services) => {
        if (err || !services?.length) { clearTimeout(connectTimer); connecting = false; diag.connectingAt = null; return scheduleReconnect() }
        services[0].discoverCharacteristics([WRITE_UUID, NOTIFY_UUID], (err, chars) => {
          clearTimeout(connectTimer)
          if (err) { connecting = false; diag.connectingAt = null; return scheduleReconnect() }
          const wc = chars.find(c => c.uuid === WRITE_UUID)
          const nc = chars.find(c => c.uuid === NOTIFY_UUID)
          if (!wc || !nc) { connecting = false; diag.connectingAt = null; return scheduleReconnect() }
          writeChar           = wc
          diag.connectedAt    = Date.now()
          diag.connectingAt   = null
          diag.disconnectedAt = null
          nc.subscribe(err => {
            if (err) events.emit('error', new Error(`BM6 subscribe: ${err.message}`))
          })
          nc.removeAllListeners('data')
          nc.on('data', onData)
          clearInterval(pollTimer)
          connecting = false
          events.emit('connected')
          // Resume scanning with allowDuplicates=true so the solar reader gets continuous advertisements
          noble.startScanning([], true)
          sendHandshake()
          // Re-send handshake on interval — device stops notifying if not periodically polled
          pollTimer = setInterval(sendHandshake, interval)
        })
      })
    })
    p.on('disconnect', () => {
      clearTimeout(connectTimer)
      connecting = false
      diag.connectingAt   = null
      diag.disconnectedAt = Date.now()
      events.emit('disconnected')
      clearInterval(pollTimer)
      writeChar = null
      if (running) scheduleReconnect()
    })
  }

  function scheduleReconnect() {
    connecting = false
    diag.reconnectScheduledAt = Date.now()
    reconnTimer = setTimeout(() => {
      if (running) noble.startScanning([], true)
    }, 5000)
  }

  return {
    start() {
      running = true
      try { noble = require('@abandonware/noble') }
      catch (err) {
        if (err.code === 'MODULE_NOT_FOUND') {
          events.emit('error', new Error('BLE driver requires @abandonware/noble — run: npm install @abandonware/noble'))
          return
        }
        if (running) setTimeout(() => this.start(), 5000)
        return
      }

      if (!nobleReady) {
        nobleReady = true
        noble.on('stateChange', state => {
          diag.nobleState = state
          if (state === 'poweredOn') {
            diag.scanStartedAt = Date.now()
            noble.startScanning([], false)
          }
        })
        noble.on('discover', p => {
          if (!matchDevice(p)) return
          diag.lastMatchAt = Date.now()
          noble.stopScanning()
          connect(p)
        })
      }
      if (noble.state === 'poweredOn') {
        diag.nobleState    = noble.state
        diag.scanStartedAt = Date.now()
        noble.startScanning([], false)
      }
    },
    stop() {
      running = false
      clearInterval(pollTimer)
      clearTimeout(reconnTimer)
      peripheral?.disconnect()
    },
    diagnostics() {
      return {
        driver:               'bm6',
        nobleState:           diag.nobleState,
        targetMac:            mac || '(any BM6)',
        scanStartedAt:        diag.scanStartedAt,
        devicesSeenInScan:    diag.devicesSeenInScan,
        devicesSeenTotal:     diag.devicesSeenTotal,
        lastMatchAt:          diag.lastMatchAt,
        connectAttempts:      diag.connectAttempts,
        connectingAt:         diag.connectingAt,
        connectedAt:          diag.connectedAt,
        disconnectedAt:       diag.disconnectedAt,
        reconnectScheduledAt: diag.reconnectScheduledAt,
        lastRxAt:             diag.lastRxAt,
        rxBytesTotal:         diag.rxBytesTotal,
        parseOk:              diag.parseOk,
        parseErrors:          diag.parseErrors,
        lastReadingAt:        diag.lastReadingAt,
        lastReading:          diag.lastReading,
        secondsSinceReading:  diag.lastReadingAt ? +((Date.now() - diag.lastReadingAt) / 1000).toFixed(1) : null,
        lastRawHex:           diag.lastRawHex,
        lastDecryptedHex:     diag.lastDecryptedHex,
      }
    },
    events,
  }
}

module.exports = { createBleReader }
