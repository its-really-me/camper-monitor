'use strict'

const { EventEmitter } = require('events')

// Simulates a 12V lead-acid starter battery.
// Cycles through: resting → engine start (brief sag) → alternator charging → engine off → resting
function createMockReader(config) {
  const events   = new EventEmitter()
  const interval = config.pollInterval ?? 5000

  let timer      = null
  let tick       = 0
  // Cycle length in ticks: ~120 ticks = 2 min at 1s intervals
  const CYCLE    = 120

  function reading() {
    const phase = tick % CYCLE
    let voltage, temperature

    if (phase < 5) {
      // Engine cranking — brief voltage sag
      voltage = +(11.2 + Math.random() * 0.4).toFixed(2)
    } else if (phase < 60) {
      // Alternator charging
      voltage = +(13.8 + Math.random() * 0.4).toFixed(2)
    } else {
      // Engine off, battery at rest — gentle drift down from full
      const restPhase = phase - 60
      voltage = +(12.7 - restPhase * 0.008 + (Math.random() - 0.5) * 0.05).toFixed(2)
    }

    temperature = +(20 + Math.random() * 10).toFixed(1)

    const charging = voltage > 13.2
    const soc      = charging ? null : voltageToSoc(voltage)
    const status   = charging ? 'charging' : 'idle'

    tick++
    return { voltage, temperature, soc, current: null, power: null, status, ts: Date.now() }
  }

  let lastReading   = null
  let lastReadingAt = null
  let readingsTotal = 0

  events.on('data', r => { lastReading = r; lastReadingAt = Date.now(); readingsTotal++ })

  return {
    start() {
      events.emit('connected')
      const r = reading(); events.emit('data', r)
      timer = setInterval(() => events.emit('data', reading()), interval)
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

const SOC_TABLE = [
  [12.70, 100], [12.60, 95], [12.50, 90], [12.40, 80],
  [12.30,  70], [12.20, 60], [12.10, 50], [12.00, 40],
  [11.90,  30], [11.80, 20], [11.70, 10], [11.60,  5],
]
function voltageToSoc(v) {
  for (const [threshold, soc] of SOC_TABLE) if (v >= threshold) return soc
  return 0
}

module.exports = { createMockReader }
