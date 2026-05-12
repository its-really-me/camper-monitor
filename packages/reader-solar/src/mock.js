'use strict'

const { EventEmitter } = require('events')

function createMockReader(config) {
  const events   = new EventEmitter()
  const interval = config.pollInterval ?? 2000
  let timer      = null
  let yieldToday = 0.0
  let lastHour   = new Date().getHours()

  function getPvPower() {
    const now  = new Date()
    const hour = now.getHours() + now.getMinutes() / 60
    if (hour < 7.0 || hour > 19.5) return 0
    const fraction = Math.sin(Math.PI * (hour - 7.0) / 12.5)
    return Math.round(fraction * 120 * (0.82 + Math.random() * 0.18))
  }

  function tick() {
    const h = new Date().getHours()
    if (h !== lastHour) { yieldToday = 0; lastHour = h }   // reset at midnight (simplification)

    const pvPower   = getPvPower()
    const pvVoltage = pvPower > 0
      ? +(14.5 + (pvPower / 120) * 5.5 + (Math.random() - 0.5) * 0.2).toFixed(2)
      : 18.2   // open-circuit at night
    const pvCurrent      = pvVoltage > 0 ? +(pvPower / pvVoltage).toFixed(2) : 0
    const batteryCurrent = +(pvPower / 13.2).toFixed(2)
    const batteryVoltage = +(12.6 + batteryCurrent * 0.04 + (Math.random() - 0.5) * 0.02).toFixed(2)

    let mode = 'Off'
    if (pvPower > 80)      mode = 'Bulk'
    else if (pvPower > 25) mode = 'Absorption'
    else if (pvPower > 0)  mode = 'Float'

    yieldToday += (pvPower * interval) / 3_600_000_000  // W·ms → kWh

    events.emit('data', {
      pvVoltage,
      pvPower,
      pvCurrent,
      batteryCurrent,
      batteryVoltage,
      mode,
      mpptMode:   pvPower > 0 ? 'active' : 'off',
      yieldToday: +yieldToday.toFixed(3),
      ts:         Date.now(),
    })
  }

  let lastReading   = null
  let lastReadingAt = null
  let readingsTotal = 0

  events.on('data', r => { lastReading = r; lastReadingAt = Date.now(); readingsTotal++ })

  return {
    start() {
      events.emit('connected')
      tick()
      timer = setInterval(tick, interval)
    },
    stop() {
      clearInterval(timer)
      events.emit('disconnected')
    },
    diagnostics() {
      return {
        driver:              'mock',
        readingsTotal,
        lastReadingAt,
        lastReading,
        secondsSinceReading: lastReadingAt ? +((Date.now() - lastReadingAt) / 1000).toFixed(1) : null,
      }
    },
    events,
  }
}

module.exports = { createMockReader }
