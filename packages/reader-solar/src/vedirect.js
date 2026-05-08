'use strict'

// Victron VE.Direct text protocol reader
// Baud: 19200 8N1
// SmartSolar fields used: VPV, PPV, I, V, CS, MPPT, H20
//
// Each block ends with "Checksum\t<byte>" where the byte makes the
// running sum of all block bytes equal 0 mod 256.

const { EventEmitter } = require('events')

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

const MPPT_LABELS = { 0: 'off', 1: 'limited', 2: 'active' }
const CHECKSUM_MARKER = Buffer.from('Checksum\t')

function parseBlock(fields) {
  const vpv  = parseInt(fields.VPV  ?? '0', 10) / 1000    // mV → V
  const ppv  = parseInt(fields.PPV  ?? '0', 10)            // W
  const iraw = parseInt(fields.I    ?? '0', 10) / 1000    // mA → A
  const vraw = parseInt(fields.V    ?? '0', 10) / 1000    // mV → V
  const cs   = parseInt(fields.CS   ?? '0', 10)
  const mppt = parseInt(fields.MPPT ?? '0', 10)
  const h20  = parseInt(fields.H20  ?? '0', 10) / 100     // 0.01 kWh → kWh

  return {
    pvVoltage:      +vpv.toFixed(3),
    pvPower:        ppv,
    pvCurrent:      vpv > 0 ? +(ppv / vpv).toFixed(2) : 0,
    batteryCurrent: +iraw.toFixed(3),
    batteryVoltage: +vraw.toFixed(3),
    mode:           CS_MODES[cs] ?? 'Unknown',
    mpptMode:       MPPT_LABELS[mppt] ?? 'unknown',
    yieldToday:     +h20.toFixed(2),
    ts:             Date.now(),
  }
}

function createVeDirectReader(config) {
  const events = new EventEmitter()
  let port     = null
  let rawBuf   = Buffer.alloc(0)

  function processBuffer() {
    let pos = 0
    while (pos < rawBuf.length) {
      const idx = rawBuf.indexOf(CHECKSUM_MARKER, pos)
      if (idx === -1) break

      const csPos = idx + CHECKSUM_MARKER.length
      if (csPos >= rawBuf.length) break   // checksum byte not yet received

      // block = bytes from pos to csPos inclusive
      const block = rawBuf.slice(pos, csPos + 1)
      const sum   = block.reduce((a, b) => a + b, 0) & 0xFF

      if (sum === 0) {
        // Valid block — parse text section (everything before "Checksum\t")
        const text   = rawBuf.slice(pos, idx).toString('latin1')
        const fields = {}
        for (const line of text.replace(/^\r\n/, '').split('\r\n')) {
          const tab = line.indexOf('\t')
          if (tab > 0) fields[line.slice(0, tab)] = line.slice(tab + 1)
        }
        if (Object.keys(fields).length >= 3) {
          try { events.emit('data', parseBlock(fields)) }
          catch (e) { events.emit('error', e) }
        }
      }

      pos = csPos + 1
      // skip trailing \r\n between blocks
      if (rawBuf[pos] === 0x0D) pos++
      if (rawBuf[pos] === 0x0A) pos++
    }
    rawBuf = rawBuf.slice(pos)
  }

  return {
    start() {
      let SerialPort
      try { ({ SerialPort } = require('serialport')) }
      catch { throw new Error('VE.Direct driver requires serialport — run: npm install serialport') }

      port = new SerialPort({
        path:     config.port ?? process.env.SOLAR_PORT ?? '/dev/ttyUSB0',
        baudRate: 19200,
        dataBits: 8,
        parity:   'none',
        stopBits: 1,
      })
      port.on('open',  ()    => events.emit('connected'))
      port.on('error', err   => events.emit('error', err))
      port.on('close', ()    => events.emit('disconnected'))
      port.on('data',  chunk => { rawBuf = Buffer.concat([rawBuf, chunk]); processBuffer() })
    },
    stop() {
      if (port?.isOpen) port.close()
    },
    events,
  }
}

module.exports = { createVeDirectReader }
