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

// SoC lookup table for 12V lead-acid (open-circuit voltage)
const SOC_TABLE = [
  [12.70, 100],
  [12.60,  95],
  [12.50,  90],
  [12.40,  80],
  [12.30,  70],
  [12.20,  60],
  [12.10,  50],
  [12.00,  40],
  [11.90,  30],
  [11.80,  20],
  [11.70,  10],
  [11.60,   5],
]

function voltageToSoc(voltage) {
  for (const [v, soc] of SOC_TABLE) {
    if (voltage >= v) return soc
  }
  return 0
}

function decrypt(buf) {
  const decipher = crypto.createDecipheriv('aes-128-cbc', KEY, IV)
  decipher.setAutoPadding(false)
  return Buffer.concat([decipher.update(buf), decipher.final()])
}

function parsePayload(buf) {
  if (buf.length < 16) return null
  let d
  try { d = decrypt(buf.slice(0, 16)) } catch { return null }

  // Bytes 2-3: voltage as BE uint16 × 0.01 V
  const voltage = d.readUInt16BE(2) / 100
  if (voltage < 8 || voltage > 20) return null   // sanity: reject garbage frames

  // Bytes 4-5: temperature, 0.1 K units (same encoding as JBD BMS)
  const rawTemp    = d.readUInt16BE(4)
  const tempC      = (rawTemp - 2731) / 10
  const temperature = (rawTemp > 0 && tempC > -40 && tempC < 80) ? +tempC.toFixed(1) : null

  // Voltage > 13.2 V means the alternator is charging — OCV-based SoC is meaningless then
  const charging = voltage > 13.2
  const soc      = charging ? null : voltageToSoc(voltage)
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

  const diag = {
    nobleState:           'unknown',
    scanStartedAt:        null,
    devicesSeenInScan:    [],
    lastMatchAt:          null,
    connectAttempts:      0,
    connectedAt:          null,
    disconnectedAt:       null,
    reconnectScheduledAt: null,
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
    if (existing) { existing.ts = Date.now() }
    else {
      diag.devicesSeenInScan.push({ address: addr, name, ts: Date.now() })
      if (diag.devicesSeenInScan.length > 10) diag.devicesSeenInScan.shift()
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
    diag.connectAttempts++
    peripheral = p
    p.connect(err => {
      if (err) return scheduleReconnect()
      p.discoverServices([SERVICE_UUID], (err, services) => {
        if (err || !services?.length) return scheduleReconnect()
        services[0].discoverCharacteristics([WRITE_UUID, NOTIFY_UUID], (err, chars) => {
          if (err) return scheduleReconnect()
          const wc = chars.find(c => c.uuid === WRITE_UUID)
          const nc = chars.find(c => c.uuid === NOTIFY_UUID)
          if (!wc || !nc) return scheduleReconnect()
          writeChar           = wc
          diag.connectedAt    = Date.now()
          diag.disconnectedAt = null
          nc.subscribe()
          nc.on('data', onData)
          events.emit('connected')
          sendHandshake()
          // Re-send handshake on interval — device stops notifying if not periodically polled
          pollTimer = setInterval(sendHandshake, interval)
        })
      })
    })
    p.on('disconnect', () => {
      diag.disconnectedAt = Date.now()
      events.emit('disconnected')
      clearInterval(pollTimer)
      writeChar = null
      if (running) scheduleReconnect()
    })
  }

  function scheduleReconnect() {
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
        lastMatchAt:          diag.lastMatchAt,
        connectAttempts:      diag.connectAttempts,
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
      }
    },
    events,
  }
}

module.exports = { createBleReader }
