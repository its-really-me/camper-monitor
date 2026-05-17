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
    connectingAt:         null,
    connectL2At:          null,   // set when p.connect() callback fires (L2 link up)
    connectGattStage:     null,   // 1 = discoverServices(filtered), 2 = discoverServices(all)
    connectedAt:          null,
    disconnectedAt:       null,
    reconnectScheduledAt: null,
    lastConnectError:     null,
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
      if (diag.devicesSeenInScan.length > 100) diag.devicesSeenInScan.shift()
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
    diag.connectingAt = Date.now()
    peripheral = p
    p.removeAllListeners('disconnect')

    // Abort if connect/GATT discovery hangs — 60s to accommodate slow BMS enumeration
    let connectTimer = setTimeout(() => {
      if (!connecting) return
      const hadL2    = diag.connectL2At !== null
      const stage    = diag.connectGattStage
      connecting = false
      diag.connectingAt    = null
      diag.connectL2At     = null
      diag.connectGattStage = null
      diag.lastConnectError = hadL2
        ? `connect timeout (60s) — GATT discovery hung at stage ${stage} after L2 link was up`
        : 'connect timeout (60s) — p.connect() never called back (L2 hang)'
      p.disconnect()
      scheduleReconnect()
    }, 60000)

    p.connect(err => {
      if (err) { clearTimeout(connectTimer); connecting = false; diag.connectingAt = null; diag.connectL2At = null; diag.connectGattStage = null; diag.lastConnectError = `connect: ${err.message}`; return scheduleReconnect() }
      diag.connectL2At     = Date.now()   // L2 link is up; GATT discovery starts now
      diag.connectGattStage = 1
      // Fast path: filter for known JBD service UUID
      p.discoverServices([SERVICE_UUID], (err, services) => {
        if (err) { clearTimeout(connectTimer); connecting = false; diag.connectingAt = null; diag.connectGattStage = null; diag.lastConnectError = `discoverServices: ${err.message}`; return scheduleReconnect() }
        if (services?.length) {
          // Service found — proceed directly to characteristics
          continueWithService(services[0])
        } else {
          // Non-JBD device — enumerate all services looking for a write+notify pair
          diag.connectGattStage = 2
          p.discoverServices([], (err2, all) => {
            if (err2) { clearTimeout(connectTimer); connecting = false; diag.connectingAt = null; diag.connectGattStage = null; diag.lastConnectError = `discoverServices(all): ${err2.message}`; return scheduleReconnect() }
            const svcUuids = (all ?? []).map(s => s.uuid).join(',')
            const unknown  = (all ?? []).filter(s => s.uuid !== '1800' && s.uuid !== '1801')
            if (!unknown.length) {
              clearTimeout(connectTimer); connecting = false; diag.connectingAt = null; diag.connectGattStage = null
              diag.lastConnectError = `service ${SERVICE_UUID} not found; device has: ${svcUuids}`
              p.disconnect(); return scheduleReconnect()
            }
            // Try each non-standard service in turn looking for write + notify
            ;(function tryNextService(idx) {
              if (idx >= unknown.length) {
                clearTimeout(connectTimer); connecting = false; diag.connectingAt = null; diag.connectGattStage = null
                diag.lastConnectError = `service ${SERVICE_UUID} not found; no write+notify pair in: ${svcUuids}`
                p.disconnect(); return scheduleReconnect()
              }
              const svc = unknown[idx]
              svc.discoverCharacteristics([], (err3, chars) => {
                if (err3) return tryNextService(idx + 1)
                const info = (chars ?? []).map(c => `${c.uuid}[${c.properties.join(',')}]`).join(' ')
                diag.lastConnectError = `service ${SERVICE_UUID} not found; device has: ${svcUuids}; service ${svc.uuid} chars: ${info}`
                const wc = (chars ?? []).find(c => c.properties.some(pr => pr === 'write' || pr === 'writeWithoutResponse'))
                const nc = (chars ?? []).find(c => c.properties.includes('notify'))
                if (!wc || !nc) return tryNextService(idx + 1)
                // Found write+notify on non-JBD service — attempt JBD protocol
                setupWithChars(wc, nc)
              })
            })(0)
          })
        }
      })

      function setupWithChars(wc, nc) {
        clearTimeout(connectTimer)
        writeChar = wc
        diag.connectedAt    = Date.now()
        diag.connectingAt   = null
        diag.connectGattStage = null
        diag.disconnectedAt = null
        nc.subscribe(err => {
          if (err) events.emit('error', new Error(`BMS subscribe: ${err.message}`))
        })
        nc.removeAllListeners('data')
        nc.on('data', onData)
        clearInterval(pollTimer)
        connecting = false
        events.emit('connected')
        // Resume scanning with allowDuplicates=true so the solar reader gets continuous advertisements
        noble.startScanning([], true)
        poll()
        pollTimer = setInterval(poll, interval)
      }

      function continueWithService(svc) {
        svc.discoverCharacteristics([WRITE_UUID, NOTIFY_UUID], (err, chars) => {
          clearTimeout(connectTimer)
          if (err) { connecting = false; diag.connectingAt = null; diag.connectGattStage = null; diag.lastConnectError = `discoverCharacteristics: ${err.message}`; return scheduleReconnect() }
          const wc = chars.find(c => c.uuid === WRITE_UUID)
          const nc = chars.find(c => c.uuid === NOTIFY_UUID)
          if (!wc || !nc) { connecting = false; diag.connectingAt = null; diag.connectGattStage = null; diag.lastConnectError = `characteristics not found (found: ${chars.map(c => c.uuid).join(',')})`; return scheduleReconnect() }
          setupWithChars(wc, nc)
        })
      }
    })
    p.on('disconnect', () => {
      clearTimeout(connectTimer)
      connecting = false
      diag.connectingAt    = null
      diag.connectL2At     = null
      diag.connectGattStage = null
      diag.disconnectedAt  = Date.now()
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
        connectingAt:         diag.connectingAt,
        connectL2At:          diag.connectL2At,
        connectGattStage:     diag.connectGattStage,
        lastConnectError:     diag.lastConnectError,
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
