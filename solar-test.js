'use strict'
// Run from camper-monitor root: node solar-test.js
// Tests all reasonable nonce/offset combinations against recent mfr samples.
// Any line marked *** is a plausible hit — report that combination.

const crypto = require('crypto')
const path   = require('path')
const fs     = require('fs')
const yaml   = require('js-yaml')

const cfg    = yaml.load(fs.readFileSync(path.join(__dirname, 'settings.yaml'), 'utf8'))
const keyHex = (cfg.readers.solar.advertisementKey ?? '').replace(/\s/g, '')
const key    = Buffer.from(keyHex, 'hex')

if (key.length !== 16) { console.error(`Key wrong length: ${key.length} bytes (expected 16)`); process.exit(1) }
console.log(`Key OK — ${keyHex}`)

// Paste the latest mfrHex values from /diagnostics here:
const SAMPLES = [
  'e102100275a001d3a1fb6b19c2455efd5685e3ab803d',
  'e102100275a001cba3fbefa2bbf9718b9202e5ca99aa',
  'e102100275a0013ba8fb0306bc0e9b3c2b27ed2c5008',
]

// MAC address of the solar charger (from settings.yaml or diagnostics targetMac):
const MAC_HEX = 'd87bda348da6'   // ← update if different

function isPlausible(dec) {
  if (dec.length < 10) return false
  const battV      = dec.readUInt16LE(2) / 100
  const battI      = dec.readInt16LE(4) / 10
  const yieldToday = dec.readUInt16LE(6) / 100
  const pvPower    = dec.readUInt16LE(8)
  return battV >= 11 && battV <= 16.5 &&
         Math.abs(battI) <= 150 &&
         pvPower <= 3000 &&
         yieldToday <= 30
}

function fmtDec(dec) {
  const battV      = dec.readUInt16LE(2) / 100
  const battI      = dec.readInt16LE(4) / 10
  const pvPower    = dec.readUInt16LE(8)
  const yieldToday = dec.readUInt16LE(6) / 100
  return `battV=${battV.toFixed(2)}V battI=${battI.toFixed(1)}A pvPower=${pvPower}W yield=${yieldToday.toFixed(2)}kWh CS=${dec[0]}`
}

function tryAll(mfr) {
  const mac = Buffer.from(MAC_HEX, 'hex')

  // All nonce candidates to try
  const nonces = {
    'n[4:6]':  [mfr[4], mfr[5]],
    'n[3:5]':  [mfr[3], mfr[4]],
    'n[5:7]':  [mfr[5], mfr[6]],
    'n[6:8]':  [mfr[6], mfr[7]],
    'n[3:7]':  [mfr[3], mfr[4], mfr[5], mfr[6]],
    'nZero':   [],
    'nMAC01':  [mac[0], mac[1]],
    'nMAC45':  [mac[4], mac[5]],
    'nMAC_6b': [mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]],
    'nMAC_6b_rev': [mac[5], mac[4], mac[3], mac[2], mac[1], mac[0]],
  }

  for (let encStart = 3; encStart <= 10; encStart++) {
    if (encStart >= mfr.length - 9) continue
    for (const [label, nb] of Object.entries(nonces)) {
      const nonce = Buffer.alloc(16)
      Buffer.from(nb).copy(nonce)
      const c   = crypto.createDecipheriv('aes-128-ctr', key, nonce)
      const dec = Buffer.concat([c.update(mfr.slice(encStart)), c.final()])
      if (isPlausible(dec)) {
        console.log(`\n*** HIT  enc@${encStart} ${label.padEnd(12)} ${fmtDec(dec)}`)
        console.log(`         dec=${dec.toString('hex')}`)
      }
    }
  }
}

// Also try with reversed key
const keyRev = Buffer.from(key).reverse()
function tryReversedKey(mfr) {
  const nb    = [mfr[4], mfr[5]]
  for (let encStart = 5; encStart <= 8; encStart++) {
    const nonce = Buffer.alloc(16)
    Buffer.from(nb).copy(nonce)
    const c   = crypto.createDecipheriv('aes-128-ctr', keyRev, nonce)
    const dec = Buffer.concat([c.update(mfr.slice(encStart)), c.final()])
    if (isPlausible(dec)) {
      console.log(`\n*** HIT (rev key)  enc@${encStart} ${fmtDec(dec)}`)
    }
  }
}

for (const hex of SAMPLES) {
  console.log(`\nSample ${hex}`)
  const mfr = Buffer.from(hex, 'hex')
  tryAll(mfr)
  tryReversedKey(mfr)
}

console.log('\n--- done ---')
console.log('No *** HIT lines = key is wrong or data format unknown.')
console.log('If hits appear, note the enc@ offset and nonce label.')
