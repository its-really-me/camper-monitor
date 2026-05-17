'use strict'
// Run from camper-monitor root: node solar-test.js
// Tests all key byte-order variants × all enc offsets × all nonce schemes.
// Any *** HIT line gives the exact parameters to fix the server code.

const crypto = require('crypto')
const path   = require('path')
const fs     = require('fs')
const yaml   = require('js-yaml')

const cfg    = yaml.load(fs.readFileSync(path.join(__dirname, 'settings.yaml'), 'utf8'))
const keyHex = (cfg.readers.solar.advertisementKey ?? '').replace(/\s/g, '')
const keyBuf = Buffer.from(keyHex, 'hex')

if (keyBuf.length !== 16) { console.error(`Key wrong length: ${keyBuf.length} bytes (expected 16)`); process.exit(1) }
console.log(`Key: ${keyHex}`)

// ── Paste latest mfrHex values from /diagnostics here ─────────────────────
const SAMPLES = [
  'e102100275a001d3a1fb6b19c2455efd5685e3ab803d',
  'e102100275a001cba3fbefa2bbf9718b9202e5ca99aa',
  'e102100275a0013ba8fb0306bc0e9b3c2b27ed2c5008',
]

// MAC of solar charger (no colons):
const MAC_HEX = 'd87bda348da6'
// ──────────────────────────────────────────────────────────────────────────

// Key variants to try
function keyVariants(k) {
  const rev = Buffer.from(k).reverse()
  // swap bytes within each 32-bit word
  const w32 = Buffer.from(k)
  for (let i = 0; i < 16; i += 4) { w32[i]=k[i+3]; w32[i+1]=k[i+2]; w32[i+2]=k[i+1]; w32[i+3]=k[i] }
  // swap bytes within each 16-bit word
  const w16 = Buffer.from(k)
  for (let i = 0; i < 16; i += 2) { w16[i]=k[i+1]; w16[i+1]=k[i] }
  // swap nibbles within each byte
  const nib = Buffer.from(k).map(b => ((b & 0x0f) << 4) | ((b & 0xf0) >> 4))
  return { 'key-orig': k, 'key-rev': rev, 'key-w32swap': w32, 'key-w16swap': w16, 'key-nibswap': nib }
}

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
  return `battV=${(dec.readUInt16LE(2)/100).toFixed(2)}V ` +
         `battI=${(dec.readInt16LE(4)/10).toFixed(1)}A ` +
         `pvPower=${dec.readUInt16LE(8)}W ` +
         `yield=${(dec.readUInt16LE(6)/100).toFixed(2)}kWh ` +
         `CS=${dec[0]}`
}

const mac = Buffer.from(MAC_HEX, 'hex')

function noncesFor(mfr) {
  return {
    'n[4:6]':      [mfr[4], mfr[5]],
    'n[3:5]':      [mfr[3], mfr[4]],
    'n[5:7]':      [mfr[5], mfr[6]],
    'n[6:8]':      [mfr[6], mfr[7]],
    'n[3:7]4b':    [mfr[3], mfr[4], mfr[5], mfr[6]],
    'nZero':       [],
    'nMAC[0:2]':   [mac[0], mac[1]],
    'nMAC[4:6]':   [mac[4], mac[5]],
    'nMAC_full':   [...mac],
    'nMAC_rev':    [...Buffer.from(mac).reverse()],
  }
}

let hits = 0

for (const hex of SAMPLES) {
  const mfr    = Buffer.from(hex, 'hex')
  const nonces = noncesFor(mfr)
  const keys   = keyVariants(keyBuf)

  for (const [kLabel, k] of Object.entries(keys)) {
    for (let encStart = 3; encStart <= 10; encStart++) {
      if (mfr.length - encStart < 10) continue
      for (const [nLabel, nb] of Object.entries(nonces)) {
        const nonce = Buffer.alloc(16)
        Buffer.from(nb).copy(nonce)
        const c   = crypto.createDecipheriv('aes-128-ctr', k, nonce)
        const dec = Buffer.concat([c.update(mfr.slice(encStart)), c.final()])
        if (isPlausible(dec)) {
          hits++
          console.log(`\n*** HIT  ${kLabel}  enc@${encStart}  ${nLabel}`)
          console.log(`         ${fmtDec(dec)}`)
          console.log(`         dec=${dec.toString('hex')}`)
          console.log(`         mfr=${hex}`)
        }
      }
    }
  }
}

console.log(`\n--- done — ${hits} hit(s) ---`)
if (!hits) {
  console.log('No hits. Either:')
  console.log('  1. The mfr samples above pre-date the current firmware/key — paste fresh ones from /diagnostics and re-run.')
  console.log('  2. The advertisement key is wrong — double-check in VictronConnect → device → settings → ⋮ → Product info → Instant Readout.')
}
