'use strict'

function createReader(config) {
  const driver = config.driver ?? 'mock'
  switch (driver) {
    case 'bm6':  return require('./ble').createBleReader(config)
    case 'mock': return require('./mock').createMockReader(config)
    default:     throw new Error(`Unknown starter driver: "${driver}". Valid: bm6, mock`)
  }
}

module.exports = { createReader }
