'use strict'

require('dotenv').config()

const path = require('path')
const fs   = require('fs')
const yaml = require('js-yaml')

const { createReader: createBatteryReader } = require('@camper-monitor/reader-battery')
const { createReader: createSolarReader }   = require('@camper-monitor/reader-solar')
const { createApi }                         = require('./api')

function loadConfig() {
  const cfgPath = path.resolve(__dirname, '../../../settings.yaml')
  const cfg = yaml.load(fs.readFileSync(cfgPath, 'utf8'))

  // Environment variable overrides
  if (process.env.BATTERY_DRIVER) cfg.readers.battery.driver = process.env.BATTERY_DRIVER
  if (process.env.SOLAR_DRIVER)   cfg.readers.solar.driver   = process.env.SOLAR_DRIVER
  if (process.env.SOLAR_PORT)     cfg.readers.solar.port     = process.env.SOLAR_PORT
  if (process.env.PORT)           cfg.server.port            = parseInt(process.env.PORT, 10)

  return cfg
}

function main() {
  const cfg = loadConfig()
  console.log(`Battery driver : ${cfg.readers.battery.driver}`)
  console.log(`Solar driver   : ${cfg.readers.solar.driver}`)

  const state = {
    battery:          null,
    solar:            null,
    batteryConnected: false,
    solarConnected:   false,
    toJSON() {
      return {
        battery:          this.battery,
        solar:            this.solar,
        batteryConnected: this.batteryConnected,
        solarConnected:   this.solarConnected,
      }
    },
  }

  const { app, push } = createApi(state)

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

  wire(batteryReader, 'battery', 'batteryConnected')
  wire(solarReader,   'solar',   'solarConnected')

  const port = cfg.server?.port ?? 3000
  app.listen(port, () => console.log(`Server →  http://localhost:${port}`))

  batteryReader.start()
  solarReader.start()

  process.on('SIGINT', () => {
    batteryReader.stop()
    solarReader.stop()
    process.exit(0)
  })
}

main()
