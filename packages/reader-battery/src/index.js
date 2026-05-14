/**
 * Camper Monitor — reader-battery/index.js
 * Battery reader factory — selects BLE or mock driver from config.
 *
 * © 2026 Kai Steuernagel
 */

'use strict'

function createReader(config) {
  const driver = config.driver ?? 'mock'
  switch (driver) {
    case 'ble':  return require('./ble').createBleReader(config)
    case 'mock': return require('./mock').createMockReader(config)
    default:     throw new Error(`Unknown battery driver: "${driver}". Valid: ble, mock`)
  }
}

module.exports = { createReader }
