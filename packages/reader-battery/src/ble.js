/**
 * Camper Monitor — reader-battery/ble.js
 * Generic BLE connection manager for battery BMS readers.
 * Protocol-specific framing and parsing is delegated to protocol/*.js modules.
 *
 * © 2026 Kai Steuernagel
 */

'use strict'

const { EventEmitter } = require('events')

function createBleReader(config) {
  const events    = new EventEmitter()
  const mac       = (config.macAddress ?? '').toLowerCase()
  const interval  = config.pollInterval ?? 5000

  // Select protocol module from config — default jbd for backward compatibility
  const protocolName = config.protocol ?? 'jbd'
  let protocol
  switch (protocolName) {
    case 'jbd': protocol = require('./protocol/jbd').createProtocol(); break
    case 'eco': protocol = require('./protocol/eco').createProtocol(); break
    default: throw new Error(`Unknown battery protocol: "${protocolName}". Valid: jbd, eco`)
  }

  let noble        = null
  let peripheral   = null
  let writeChar    = null
  let pollTimer    = null
  let reconnTimer  = null
  let watchdogTimer = null
  let running      = false
  let nobleReady   = false
  let connecting   = false

  const diag = {
    nobleState:           'unknown',
    protocol:             protocolName,
    scanStartedAt:        null,
    devicesSeenInScan:    [],
    devicesSeenTotal:     0,
    lastMatchAt:          null,
    connectAttempts:      0,
    connectingAt:         null,
    connectL2At:          null,
    connectGattStage:     null,
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
    const cmds = protocol.poll()
    function sendNext(i) {
      if (i >= cmds.length || !writeChar) return
      writeChar.write(cmds[i], false, err => {
        if (err) { events.emit('error', new Error(`BMS write: ${err.message}`)); return }
        sendNext(i + 1)
      })
    }
    sendNext(0)
  }

  function onData(chunk) {
    diag.lastRxAt      = Date.now()
    diag.rxBytesTotal += chunk.length
    const reading = protocol.onData(chunk)
    if (reading) {
      diag.parseOk++
      diag.lastReadingAt = Date.now()
      diag.lastReading   = reading
      events.emit('data', reading)
    }
  }

  function connect(p) {
    if (connecting) return
    connecting = true
    diag.connectAttempts++
    diag.connectingAt = Date.now()
    peripheral = p
    p.removeAllListeners('disconnect')

    // Abort if connect/GATT discovery hangs — 60 s accommodates slow BMS enumeration
    let connectTimer = setTimeout(() => {
      if (!connecting) return
      const hadL2 = diag.connectL2At !== null
      const stage = diag.connectGattStage
      connecting = false
      diag.connectingAt     = null
      diag.connectL2At      = null
      diag.connectGattStage = null
      diag.lastConnectError = hadL2
        ? `connect timeout (60s) — GATT discovery hung at stage ${stage} after L2 link was up`
        : 'connect timeout (60s) — p.connect() never called back (L2 hang)'
      p.disconnect()
      scheduleReconnect()
    }, 60000)

    p.connect(err => {
      if (err) {
        clearTimeout(connectTimer)
        connecting = false
        diag.connectingAt     = null
        diag.connectL2At      = null
        diag.connectGattStage = null
        diag.lastConnectError = `connect: ${err.message}`
        return scheduleReconnect()
      }
      diag.connectL2At      = Date.now()
      diag.connectGattStage = 1

      if (protocol.serviceUUID) {
        // Fast path: filter for the protocol's known service UUID
        p.discoverServices([protocol.serviceUUID], (err, services) => {
          if (err) {
            clearTimeout(connectTimer)
            connecting = false
            diag.connectingAt     = null
            diag.connectGattStage = null
            diag.lastConnectError = `discoverServices: ${err.message}`
            return scheduleReconnect()
          }
          if (services?.length) {
            continueWithService(services[0])
          } else {
            doFullDiscovery()
          }
        })
      } else {
        doFullDiscovery()
      }
    })

    // Full service enumeration fallback: iterate all non-standard services looking
    // for a write + notify characteristic pair, then attempt the configured protocol.
    function doFullDiscovery() {
      diag.connectGattStage = 2
      p.discoverServices([], (err, all) => {
        if (err) {
          clearTimeout(connectTimer)
          connecting = false
          diag.connectingAt     = null
          diag.connectGattStage = null
          diag.lastConnectError = `discoverServices(all): ${err.message}`
          return scheduleReconnect()
        }
        const svcUuids = (all ?? []).map(s => s.uuid).join(',')
        const unknown  = (all ?? []).filter(s => s.uuid !== '1800' && s.uuid !== '1801')
        if (!unknown.length) {
          clearTimeout(connectTimer)
          connecting = false
          diag.connectingAt     = null
          diag.connectGattStage = null
          diag.lastConnectError = `no suitable service found; device has: ${svcUuids}`
          p.disconnect()
          return scheduleReconnect()
        }
        ;(function tryNextService(idx) {
          if (idx >= unknown.length) {
            clearTimeout(connectTimer)
            connecting = false
            diag.connectingAt     = null
            diag.connectGattStage = null
            diag.lastConnectError = `no write+notify pair found in services: ${svcUuids}`
            p.disconnect()
            return scheduleReconnect()
          }
          const svc = unknown[idx]
          svc.discoverCharacteristics([], (err3, chars) => {
            if (err3) return tryNextService(idx + 1)
            const info = (chars ?? []).map(c => `${c.uuid}[${c.properties.join(',')}]`).join(' ')
            diag.lastConnectError = `service ${protocol.serviceUUID ?? '?'} not found; device has: ${svcUuids}; service ${svc.uuid} chars: ${info}`
            const wc = (chars ?? []).find(c => c.properties.some(pr => pr === 'write' || pr === 'writeWithoutResponse'))
            const nc = (chars ?? []).find(c => c.properties.includes('notify'))
            if (!wc || !nc) return tryNextService(idx + 1)
            setupWithChars(wc, nc)
          })
        })(0)
      })
    }

    function continueWithService(svc) {
      svc.discoverCharacteristics([protocol.writeUUID, protocol.notifyUUID], (err, chars) => {
        clearTimeout(connectTimer)
        if (err) {
          connecting = false
          diag.connectingAt     = null
          diag.connectGattStage = null
          diag.lastConnectError = `discoverCharacteristics: ${err.message}`
          return scheduleReconnect()
        }
        const wc = chars.find(c => c.uuid === protocol.writeUUID)
        const nc = chars.find(c => c.uuid === protocol.notifyUUID)
        if (!wc || !nc) {
          connecting = false
          diag.connectingAt     = null
          diag.connectGattStage = null
          diag.lastConnectError = `characteristics not found (found: ${chars.map(c => c.uuid).join(',')})`
          return scheduleReconnect()
        }
        setupWithChars(wc, nc)
      })
    }

    function setupWithChars(wc, nc) {
      clearTimeout(connectTimer)
      writeChar = wc
      protocol.reset()
      diag.connectedAt      = Date.now()
      diag.connectingAt     = null
      diag.connectGattStage = null
      diag.disconnectedAt   = null
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

    p.on('disconnect', () => {
      clearTimeout(connectTimer)
      connecting = false
      diag.connectingAt     = null
      diag.connectL2At      = null
      diag.connectGattStage = null
      diag.disconnectedAt   = Date.now()
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
      if (!running) return
      noble.stopScanning()
      setTimeout(() => {
        if (running && !connecting && writeChar === null) noble.startScanning([], true)
      }, 500)
    }, 5000)
  }

  // Safety net: if we're not connected and not getting readings, prod the scanner.
  // BlueZ on Pi Zero silently stops emitting 'discover' events after an L2 hang.
  // Must stop then start — startScanning alone is a no-op if noble thinks it's already scanning.
  function startWatchdog() {
    watchdogTimer = setInterval(() => {
      if (!running || connecting || writeChar !== null) return
      noble.stopScanning()
      setTimeout(() => {
        if (running && !connecting && writeChar === null) noble.startScanning([], true)
      }, 500)
    }, 60_000)
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
      if (!watchdogTimer) startWatchdog()
    },
    stop() {
      running = false
      clearInterval(pollTimer)
      clearTimeout(reconnTimer)
      clearInterval(watchdogTimer)
      watchdogTimer = null
      peripheral?.disconnect()
    },
    diagnostics() {
      return {
        driver:               'ble',
        protocol:             protocolName,
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
