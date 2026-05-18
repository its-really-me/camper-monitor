/**
 * Camper Monitor — reader-battery/protocol/eco.js
 * Eco-Worthy AA-frame BMS protocol.
 * Used by Eco-Worthy 897A and similar batteries that do NOT speak JBD.
 *
 * © 2026 Kai Steuernagel
 *
 * Frame format:  AA [cmd] [len] [payload × len bytes] [crc_hi crc_lo]
 * Service UUID:  00000001-0000-1000-8000-00805f9b34fb  (noble: '1')
 * Write UUID:    00000002-0000-1000-8000-00805f9b34fb  (noble: '2')
 * Notify UUID:   00000003-0000-1000-8000-00805f9b34fb  (noble: '3')
 *
 * Noble strips leading zeros from 16-bit UUIDs in the BT SIG base UUID space,
 * so 0x0001 → '1', 0x0002 → '2', 0x0003 → '3'.
 *
 * Protocol reference: https://github.com/mike805/eco-worthy-battery-logger/issues/3
 */

'use strict'

const SERVICE_UUID = '1'
const WRITE_UUID   = '2'
const NOTIFY_UUID  = '3'

// Commands
const CMD_INIT = Buffer.from('aa00000000', 'hex')   // initialise device (once at connect)
const CMD_21   = Buffer.from('aa21002100', 'hex')   // request status (voltage, SOC, capacity)
const CMD_22   = Buffer.from('aa22002200', 'hex')   // request cell voltages

// Extract the next complete AA frame from buf.
// Returns { frame, remaining } where frame is null if not enough bytes yet.
function extractFrame(buf) {
  let i = 0
  while (i < buf.length) {
    if (buf[i] !== 0xAA) { i++; continue }
    if (buf.length - i < 3) break
    const payloadLen = buf[i + 2]
    const frameLen   = 3 + payloadLen + 2
    if (buf.length - i < frameLen) break
    return { frame: buf.slice(i, i + frameLen), remaining: buf.slice(i + frameLen) }
  }
  return { frame: null, remaining: buf.slice(i) }
}

function parseStatus(payload) {
  if (payload.length < 18) return null
  const voltage_mv = payload.readUInt16LE(0)
  const voltage    = +(voltage_mv / 1000).toFixed(3)
  if (voltage < 8 || voltage > 60) return null   // sanity: covers 12 V – 48 V systems
  const soc            = Math.min(100, Math.max(0, payload[8]))
  const remaining_mwh  = payload.readUInt32LE(10)
  const full_mwh       = payload.readUInt32LE(14)
  return {
    soc,
    voltage,
    current:             null,    // ECO protocol does not report current
    power:               null,
    status:              'unknown',
    temperature:         null,    // ECO protocol does not report temperature as a number
    capacityRemainingWh: +(remaining_mwh / 1000).toFixed(1),
    capacityFullWh:      +(full_mwh      / 1000).toFixed(1),
  }
}

function parseCells(payload) {
  // 8 cell voltages as big-endian uint16 millivolts, starting at payload[1]
  if (payload.length < 17) return null
  const cells = []
  for (let i = 1; i < 17; i += 2) {
    const mv = payload.readUInt16BE(i)
    if (mv > 500 && mv < 4500) cells.push(+(mv / 1000).toFixed(3))   // valid cell range
  }
  return cells.length > 0 ? cells : null
}

function createProtocol() {
  let rxBuf        = Buffer.alloc(0)
  let cells        = null    // most recent cell voltages (attached on next 0x21 reading)
  let firstPoll    = true    // send CMD_INIT once at first poll after connect
  let lastCmd22Hex = null    // raw payload bytes for debugging cell offset issues

  return {
    name:        'eco',
    serviceUUID: SERVICE_UUID,
    writeUUID:   WRITE_UUID,
    notifyUUID:  NOTIFY_UUID,

    reset() {
      rxBuf     = Buffer.alloc(0)
      cells     = null
      firstPoll = true
    },

    poll() {
      if (firstPoll) { firstPoll = false; return [CMD_INIT, CMD_21, CMD_22] }
      return [CMD_21, CMD_22]
    },

    onData(chunk) {
      rxBuf = Buffer.concat([rxBuf, chunk])
      let reading = null

      while (true) {
        const { frame, remaining } = extractFrame(rxBuf)
        rxBuf = remaining
        if (!frame) break

        const cmd     = frame[1]
        const payload = frame.slice(3, frame.length - 2)

        if (cmd === 0x22) {
          lastCmd22Hex = payload.toString('hex')
          cells = parseCells(payload)
        } else if (cmd === 0x21) {
          const base = parseStatus(payload)
          if (base) reading = { ...base, cellVoltages: cells, ts: Date.now() }
        }
      }

      return reading
    },

    diagnostics() { return { lastCmd22Hex } },
  }
}

module.exports = { createProtocol }
