/**
 * Camper Monitor — reader-battery/protocol/jbd.js
 * JBD BMS protocol — service ff00, write ff02, notify ff01.
 * Used by most JBD/Daly-OEM BMS boards.
 *
 * © 2026 Kai Steuernagel
 */

'use strict'

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

  // JBD checksum: 0x10000 - sum(buf[2..4+dataLen]) & 0xFFFF
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
    voltage:          +voltage.toFixed(2),
    current:          +current.toFixed(2),
    power:            +(Math.abs(voltage * current)).toFixed(1),
    status:           Math.abs(current) < 0.5 ? 'idle' : current > 0 ? 'charging' : 'discharging',
    temperature,
    cellVoltages:     null,
    capacityRemainingWh: null,
    capacityFullWh:   null,
    ts:               Date.now(),
  }
}

function createProtocol() {
  let rxBuf = Buffer.alloc(0)
  return {
    name:        'jbd',
    serviceUUID: SERVICE_UUID,
    writeUUID:   WRITE_UUID,
    notifyUUID:  NOTIFY_UUID,
    reset() { rxBuf = Buffer.alloc(0) },
    poll()  { return [BASIC_INFO] },
    onData(chunk) {
      rxBuf = Buffer.concat([rxBuf, chunk])
      if (rxBuf.length > 4 && rxBuf[rxBuf.length - 1] === 0x77) {
        const reading = parseResponse(rxBuf)
        rxBuf = Buffer.alloc(0)
        return reading
      }
      return null
    },
  }
}

module.exports = { createProtocol }
