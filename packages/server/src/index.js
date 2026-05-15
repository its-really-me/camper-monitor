/**
 * Camper Monitor — server/index.js
 * Server entry point — loads config, wires readers to the API, starts HTTP server.
 *
 * © 2026 Kai Steuernagel
 */

'use strict'

require('dotenv').config()

const path = require('path')
const fs   = require('fs')
const yaml = require('js-yaml')

const { createReader: createBatteryReader } = require('@camper-monitor/reader-battery')
const { createReader: createSolarReader }   = require('@camper-monitor/reader-solar')
const { createApi }                         = require('./api')

const SETTINGS_PATH = path.resolve(__dirname, '../../../settings.yaml')

function loadConfig() {
  const cfg = yaml.load(fs.readFileSync(SETTINGS_PATH, 'utf8'))

  // Environment variable overrides
  if (process.env.BATTERY_DRIVER) cfg.readers.battery.driver  = process.env.BATTERY_DRIVER
  if (process.env.SOLAR_DRIVER)   cfg.readers.solar.driver    = process.env.SOLAR_DRIVER
  if (process.env.SOLAR_PORT)     cfg.readers.solar.port      = process.env.SOLAR_PORT
  if (process.env.STARTER_DRIVER) {
    cfg.readers.starter = cfg.readers.starter ?? {}
    cfg.readers.starter.driver = process.env.STARTER_DRIVER
  }
  if (process.env.PORT)           cfg.server.port             = parseInt(process.env.PORT, 10)

  return cfg
}

function startSetupServer() {
  const port = parseInt(process.env.PORT ?? '3000', 10)
  const { app } = createApi(null, { setupMode: true, settingsPath: SETTINGS_PATH })
  app.listen(port, () => console.log(`Setup UI →  http://localhost:${port}/setup`))
}

function startNormalServer() {
  const cfg = loadConfig()
  console.log(`Battery driver : ${cfg.readers.battery.driver}`)
  console.log(`Solar driver   : ${cfg.readers.solar.driver}`)
  if (cfg.readers.starter) console.log(`Starter driver : ${cfg.readers.starter.driver}`)

  const hasStarter = !!cfg.readers.starter

  const state = {
    battery:          null,
    solar:            null,
    starter:          null,
    batteryConnected: false,
    solarConnected:   false,
    starterConnected: false,
    language:         cfg.ui?.language ?? 'en',
    toJSON() {
      const out = {
        battery:          this.battery,
        solar:            this.solar,
        batteryConnected: this.batteryConnected,
        solarConnected:   this.solarConnected,
        language:         this.language,
      }
      if (hasStarter) {
        out.starter          = this.starter
        out.starterConnected = this.starterConnected
      }
      return out
    },
  }

  const { app, push } = createApi(state, {
    getDiagnostics: () => {
      const d = { battery: batteryReader.diagnostics(), solar: solarReader.diagnostics() }
      if (starterReader) d.starter = starterReader.diagnostics()
      return d
    },
  })

  function wire(reader, dataKey, connKey) {
    reader.events.on('data', reading => {
      state[dataKey] = reading
      push(state.toJSON())
    })
    reader.events.on('connected', () => {
      state[connKey] = true
      push(state.toJSON())
      console.log(`[${dataKey}] connected`)
    })
    reader.events.on('disconnected', () => {
      state[connKey] = false
      push(state.toJSON())
      console.log(`[${dataKey}] disconnected`)
    })
    reader.events.on('error', err => console.error(`[${dataKey}] error:`, err.message))
  }

  const batteryReader = createBatteryReader(cfg.readers.battery)
  const solarReader   = createSolarReader(cfg.readers.solar)
  const starterReader = hasStarter
    ? require('@camper-monitor/reader-starter').createReader(cfg.readers.starter)
    : null

  wire(batteryReader, 'battery', 'batteryConnected')
  wire(solarReader,   'solar',   'solarConnected')
  if (starterReader) wire(starterReader, 'starter', 'starterConnected')

  const port = cfg.server?.port ?? 3000
  app.listen(port, () => console.log(`Server →  http://localhost:${port}`))

  batteryReader.start()
  solarReader.start()
  starterReader?.start()

  // Initial snapshot after 10s — catches startup failures before the 60s interval fires
  setTimeout(() => {
    logReaderDiag('battery', batteryReader.diagnostics())
    logReaderDiag('solar',   solarReader.diagnostics())
    if (starterReader) logReaderDiag('starter', starterReader.diagnostics())
  }, 10_000)

  setInterval(() => {
    logReaderDiag('battery', batteryReader.diagnostics())
    logReaderDiag('solar',   solarReader.diagnostics())
    if (starterReader) logReaderDiag('starter', starterReader.diagnostics())
  }, 60_000)

  process.on('SIGINT', () => {
    batteryReader.stop()
    solarReader.stop()
    starterReader?.stop()
    process.exit(0)
  })
}

function fmtAge(s) {
  if (s < 60)   return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}min`
  return `${Math.round(s / 3600)}h`
}

function logReaderDiag(name, d) {
  if (!d) return
  const age   = d.secondsSinceReading != null ? `last=${fmtAge(d.secondsSinceReading)}` : 'no readings yet'
  const stale = d.secondsSinceReading != null && d.secondsSinceReading > 30

  let msg
  if (d.driver === 'bm6') {
    const conn = (d.connectedAt && !d.disconnectedAt)
      ? 'connected'
      : d.nobleState === 'poweredOn' ? `scanning (${d.devicesSeenTotal ?? d.devicesSeenInScan.length} devices seen)` : d.nobleState
    msg = `[diag:${name}] BM6 ${conn} · ${age} · ok=${d.parseOk} err=${d.parseErrors}`
  } else if (d.driver === 'ble' && 'connectAttempts' in d) {
    const conn = (d.connectedAt && !d.disconnectedAt)
      ? 'connected'
      : d.nobleState === 'poweredOn' ? `scanning (${d.devicesSeenTotal ?? d.devicesSeenInScan.length} devices seen)` : d.nobleState
    msg = `[diag:${name}] BLE ${conn} · ${age} · ok=${d.parseOk} err=${d.parseErrors}`
  } else if (d.driver === 'ble') {
    let conn
    if (d.nobleState !== 'poweredOn') {
      conn = d.nobleState
    } else if (d.macFilterPassed > 0 && d.victronIdPassed === 0) {
      const m = d.lastMacMatch
      const why = d.macFilterNoMfrData > 0
        ? 'no manufacturer data in advertisement'
        : d.macFilterWrongId > 0
          ? `wrong company ID: ${m?.companyId} (expected ${m?.expectedCompanyId})`
          : 'advertisement data rejected'
      conn = `device found (MAC matched ${d.macFilterPassed}×) — ${why}`
    } else {
      conn = `scanning (${d.devicesSeenTotal ?? 0} devices seen) · adv=${d.advertisementsTotal} victron=${d.victronIdPassed} solar=${d.solarChargerPassed}`
    }
    msg = `[diag:${name}] BLE ${conn} · ${age} · decrypt-err=${d.decryptErrors} parse-err=${d.parseErrors}`
  } else if (d.driver === 'vedirect') {
    msg = `[diag:${name}] VE.Direct ${d.portPath} ${d.portOpen ? 'open' : 'closed'} · ${age} · blocks=${d.blocksTotal} crc-err=${d.checksumErrors}`
  } else {
    msg = `[diag:${name}] mock · ${age} · total=${d.readingsTotal}`
  }

  if (stale) console.warn(msg + ' ← STALE')
  else       console.log(msg)
}

if (fs.existsSync(SETTINGS_PATH)) {
  startNormalServer()
} else {
  console.log('settings.yaml not found — starting setup server')
  startSetupServer()
}
