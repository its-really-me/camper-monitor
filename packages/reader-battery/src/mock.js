'use strict'

const { EventEmitter } = require('events')

function createMockReader(config) {
  const events = new EventEmitter()
  const interval = config.pollInterval ?? 5000
  let timer = null
  let soc = 85
  let charging = false   // starts discharging, flips when hitting thresholds

  function tick() {
    const current = charging
      ? +(2.0 + Math.random() * 1.5).toFixed(2)
      : -(0.8 + Math.random() * 1.8).toFixed(2)

    const voltage = +(12.0 + soc * 0.016 + (Math.random() - 0.5) * 0.05).toFixed(2)
    const power   = +(Math.abs(voltage * current)).toFixed(1)
    const status  = Math.abs(current) < 0.5 ? 'idle' : current > 0 ? 'charging' : 'discharging'

    soc += current > 0 ? 0.08 : -0.04
    soc  = Math.max(10, Math.min(98, soc))
    if (soc >= 97) charging = false
    if (soc <= 20) charging = true

    events.emit('data', {
      soc:         Math.round(soc),
      voltage,
      current,
      power,
      status,
      temperature: +(24 + Math.random() * 3).toFixed(1),
      ts:          Date.now(),
    })
  }

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
    events,
  }
}

module.exports = { createMockReader }
