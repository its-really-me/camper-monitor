'use strict'

function createReader(config) {
  const driver = config.driver ?? 'mock'
  switch (driver) {
    case 'vedirect': return require('./vedirect').createVeDirectReader(config)
    case 'ble':      return require('./ble').createBleReader(config)
    case 'mock':     return require('./mock').createMockReader(config)
    default:         throw new Error(`Unknown solar driver: "${driver}". Valid: vedirect, ble, mock`)
  }
}

module.exports = { createReader }
