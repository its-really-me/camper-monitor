/**
 * Camper Monitor — reader-battery/ble.js
 * JBD BMS BLE driver — connects, polls basic info frame, and parses battery readings.
 *
 * © 2026 Kai Steuernagel
 */

'use strict'

// JBD BMS BLE reader
// Service:  0000ff00-0000-1000-8000-00805f9b34fb
// Write:    0000ff02-0000-1000-8000-00805f9b34fb  (send requests)
// Notify:   0000ff01-0000-1000-8000-00805f9b34fb  (receive responses)

const { EventEmitter } = require('events')

const SERVICE_UUID = 'ff00'
const WRITE_UUID   = 'ff02'
const NOTIFY_UUID  = 'ff01'
const BASIC_INFO   = Buffer.from([0xDD, 0xA5, 0x03, 0x00, 0xFF, 0xFD, 0x77])

function parseResponse(buf) {
  if (buf.length < 7) return null
  if (buf[0] !== 0xDD || buf[buf.length - 1] !== 0x77) return null
  if (buf[1] !== 0x03 || buf[2] !== 0x00) return null

  const dataLen = buf[3]
  if (buf.length < 4 + dataLen + 3) return null

  // Verify JBD checksum: 0x10000 - sum(buf[2..4+dataLen]) & 0xFFFF
  let sum = 0
  for (let i = 2; i < 4 + dataLen; i++) sum += buf[i]
  const stored = buf.readUInt16BE(4 + dataLen)
  if (((0x10000 - sum) & 0xFFFF) !== stored) return null

  const d       = buf.slice(4, 4 + dataLen)
  const voltage = d.readUInt16BE(0) / 100
  const current = d.readInt16BE(2) / 100    // positive = charging
  const soc     = d[19]
  const ntcCount = d[22]
  let temperature = null
  if (ntcCount > 0 && d.length >= 25) {
    temperature = +((d.readUInt16BE(23) - 2731) / 10).toFixed(1)
  }

  return {
    soc,
    voltage:     +voltage.toFixed(2),
    current:     +current.toFixed(2),
    power:       +(Math.abs(voltage * current)).toFixed(1),
    status:      Math.abs(current) < 0.5 ? 'idle' : current > 0 ? 'charging' : 'discharging',
    temperature,
    ts:          Date.now(),
  }
}

function createBleReader(config) {
  const events     = new EventEmitter()
  const mac        = (config.macAddress ?? '').toLowerCase()
  const interval   = config.pollInterval ?? 5000
  let noble        = null
  let peripheral   = null
  let writeChar    = null
  let rxBuf        = Buffer.alloc(0)
  let pollTimer    = null
  let reconnTimer  = null
  let running      = false
  let nobleReady   = false
  let connecting   = false

  const diag = {
    nobleState:           'unknown',
    scanStartedAt:        null,
    devicesSeenInScan:    [],   // ring buffer, last 10 unique addresses
    devicesSeenTotal:     0,
    lastMatchAt:          null,
    connectAttempts:      0,
    connectedAt:          null,
    disconnectedAt:       null,
    reconnectScheduledAt: null,
    lastPollAt:           null,
    lastRxAt:             null,
    rxBytesTotal:         0,
    parseOk:              0,
    parseErrors:          0,
    lastReadingAt:        null,
    lastReading:          null,
  }

  function noteDevice(p) {
    const addr = (p.address ?? 'unknown').toLowerCase()
    const name = p.advertisement?.localName ?? ''
    const existing = diag.devicesSeenInScan.find(d => d.address === addr)
    if (existing) {
      existing.ts = Date.now()
    } else {
      diag.devicesSeenTotal++
      diag.devicesSeenInScan.push({ address: addr, name, ts: Date.now() })
      if (diag.devicesSeenInScan.length > 10) diag.devicesSeenInScan.shift()
    }
  }

  function matchDevice(p) {
    noteDevice(p)
    if (mac && p.address.toLowerCase().replace(/:/g, '') === mac.replace(/:/g, '')) return true
    const name = p.advertisement?.localName ?? ''
    return name.toLowerCase().includes('jbd') || name.toLowerCase().includes('bms')
  }

  function poll() {
    diag.lastPollAt = Date.now()
    writeChar?.write(BASIC_INFO, false, err => {
      if (err) events.emit('error', new Error(`BMS write: ${err.message}`))
    })
  }

  function onData(chunk) {
    diag.lastRxAt = Date.now()
    diag.rxBytesTotal += chunk.length
    rxBuf = Buffer.concat([rxBuf, chunk])
    if (rxBuf.length > 4 && rxBuf[rxBuf.length - 1] === 0x77) {
      const reading = parseResponse(rxBuf)
      rxBuf = Buffer.alloc(0)
      if (reading) {
        diag.parseOk++
        diag.lastReadingAt = Date.now()
        diag.lastReading   = reading
        events.emit('data', reading)
      } else {
        diag.parseErrors++
      }
    }
  }

  function connect(p) {
    if (connecting) return
    connecting = true
    diag.connectAttempts++
    peripheral = p
    p.removeAllListeners('disconnect')
    p.connect(err => {
      if (err) { connecting = false; return scheduleReconnect() }
      p.discoverServices([SERVICE_UUID], (err, services) => {
        if (err || !services?.length) { connecting = false; return scheduleReconnect() }
        services[0].discoverCharacteristics([WRITE_UUID, NOTIFY_UUID], (err, chars) => {
          if (err) { connecting = false; return scheduleReconnect() }
          const wc = chars.find(c => c.uuid === WRITE_UUID)
          const nc = chars.find(c => c.uuid === NOTIFY_UUID)
          if (!wc || !nc) { connecting = false; return scheduleReconnect() }
          writeChar = wc
          diag.connectedAt    = Date.now()
          diag.disconnectedAt = null
          nc.subscribe(err => {
            if (err) events.emit('error', new Error(`BMS subscribe: ${err.message}`))
          })
          nc.removeAllListeners('data')
          nc.on('data', onData)
          clearInterval(pollTimer)
          connecting = false
          events.emit('connected')
          // Resume scanning so other BLE readers (e.g. starter) can find their devices
          noble.startScanning([], false)
          poll()
          pollTimer = setInterval(poll, interval)
        })
      })
    })
    p.on('disconnect', () => {
      connecting = false
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
      if (running) noble.startScanning([], false)
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
        driver:               'ble',
        nobleState:           diag.nobleState,
        targetMac:            mac || '(any JBD/BMS)',
        scanStartedAt:        diag.scanStartedAt,
        devicesSeenInScan:    diag.devicesSeenInScan,
        devicesSeenTotal:     diag.devicesSeenTotal,
        lastMatchAt:          diag.lastMatchAt,
        connectAttempts:      diag.connectAttempts,
        connectedAt:          diag.connectedAt,
        disconnectedAt:       diag.disconnectedAt,
        reconnectScheduledAt: diag.reconnectScheduledAt,
        lastPollAt:           diag.lastPollAt,
        lastRxAt:             diag.lastRxAt,
        rxBytesTotal:         diag.rxBytesTotal,
        parseOk:              diag.parseOk,
        parseErrors:          diag.parseErrors,
        lastReadingAt:        diag.lastReadingAt,
        lastReading:          diag.lastReading,
        secondsSinceReading:  diag.lastReadingAt ? +((Date.now() - diag.lastReadingAt) / 1000).toFixed(1) : null,
      }
    },
    events,
  }
}

module.exports = { createBleReader }
