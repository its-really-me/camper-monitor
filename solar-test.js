'use strict'
// Run from camper-monitor root: node solar-test.js
// Tests all key byte-order variants × all enc offsets × all nonce schemes.
// Fetches the latest mfrHex from /diagnostics automatically if the server is running.
// Any *** HIT line gives the exact parameters to fix the server code.

const crypto = require('crypto')
const http   = require('http')
const path   = require('path')
const fs     = require('fs')
const yaml   = require('js-yaml')

const cfg    = yaml.load(fs.readFileSync(path.join(__dirname, 'settings.yaml'), 'utf8'))
const keyHex = (cfg.readers.solar.advertisementKey ?? '').replace(/\s/g, '')
const keyBuf = Buffer.from(keyHex, 'hex')
const port   = cfg.server?.port ?? 3000

// MAC from config — used as nonce candidate; empty string disables MAC-based nonces
const cfgMac = (cfg.readers.solar.macAddress ?? '').replace(/:/g, '').toLowerCase()

if (keyBuf.length !== 16) { console.error(`Key wrong length: ${keyBuf.length} bytes (expected 16)`); process.exit(1) }
console.log(`Key: ${keyHex}`)

// ── Fallback samples — used when the server is not running ────────────────────
// Paste fresh mfrHex values from /diagnostics here to test offline.
const FALLBACK_SAMPLES = [
  'e102100275a001d30ffb6f63f6c3a680da246ee9aac4',
  'e102100275a001edb2fb6b086507751f060c6f3adf2e',
  'e102100275a00189b3fbd71f73a3e83bbfc40d30af89',
  'e102100275a001e7b3fbf5260911c9a72d1aa4bb5a33',
]
// ─────────────────────────────────────────────────────────────────────────────

function keyVariants(k) {
  const rev = Buffer.from(k).reverse()
  const w32 = Buffer.from(k)
  for (let i = 0; i < 16; i += 4) { w32[i]=k[i+3]; w32[i+1]=k[i+2]; w32[i+2]=k[i+1]; w32[i+3]=k[i] }
  const w16 = Buffer.from(k)
  for (let i = 0; i < 16; i += 2) { w16[i]=k[i+1]; w16[i+1]=k[i] }
  const nib = Buffer.from(k).map(b => ((b & 0x0f) << 4) | ((b & 0xf0) >> 4))
  return { 'key-orig': k, 'key-rev': rev, 'key-w32swap': w32, 'key-w16swap': w16, 'key-nibswap': nib }
}

function isPlausible(dec) {
  if (dec.length < 10) return false
  const battV = dec.readUInt16LE(2) / 100
  if (battV < 11 || battV > 16.5) return false
  const battI   = dec.readInt16LE(4) / 10
  const pvPower = dec.readUInt16LE(8)
  return Math.abs(battI) <= 100 && pvPower <= 5000
}

function fmtDec(dec) {
  return `battV=${(dec.readUInt16LE(2)/100).toFixed(2)}V ` +
         `battI=${(dec.readInt16LE(4)/10).toFixed(1)}A ` +
         `pvPower=${dec.readUInt16LE(8)}W ` +
         `yield=${(dec.readUInt16LE(6)/100).toFixed(2)}kWh ` +
         `CS=${dec[0]}`
}

function noncesFor(mfr, mac) {
  const candidates = {
    'n[4:6]':   [mfr[4], mfr[5]],
    'n[3:5]':   [mfr[3], mfr[4]],
    'n[5:7]':   [mfr[5], mfr[6]],
    'n[6:8]':   [mfr[6], mfr[7]],
    'n[3:7]4b': [mfr[3], mfr[4], mfr[5], mfr[6]],
    'nZero':    [],
  }
  if (mac && mac.length === 12) {
    const mb = Buffer.from(mac, 'hex')
    candidates['nMAC[0:2]'] = [mb[0], mb[1]]
    candidates['nMAC[4:6]'] = [mb[4], mb[5]]
    candidates['nMAC_full'] = [...mb]
    candidates['nMAC_rev']  = [...Buffer.from(mb).reverse()]
  }
  return candidates
}

function runAnalysis(samples, mac) {
  let hits = 0

  for (const hex of samples) {
    const mfr    = Buffer.from(hex, 'hex')
    const nonces = noncesFor(mfr, mac)
    const keys   = keyVariants(keyBuf)

    // AES-CTR: all key variants × all enc offsets × all nonces
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
            console.log(`\n*** HIT  AES-CTR  ${kLabel}  enc@${encStart}  ${nLabel}`)
            console.log(`         ${fmtDec(dec)}`)
            console.log(`         dec=${dec.toString('hex')}`)
            console.log(`         mfr=${hex}`)
          }
        }
      }
    }

    // AES-ECB / CBC-zero-IV
    for (const [kLabel, k] of Object.entries(keys)) {
      for (let encStart = 3; encStart <= 7; encStart++) {
        const block = mfr.slice(encStart, encStart + 16)
        if (block.length < 16) continue

        try {
          const c   = crypto.createDecipheriv('aes-128-ecb', k, '')
          c.setAutoPadding(false)
          const dec = Buffer.concat([c.update(block), c.final()])
          if (isPlausible(dec)) {
            hits++
            console.log(`\n*** HIT  AES-ECB  ${kLabel}  enc@${encStart}`)
            console.log(`         ${fmtDec(dec)}`)
            console.log(`         dec=${dec.toString('hex')}`)
            console.log(`         mfr=${hex}`)
          }
        } catch {}

        try {
          const c   = crypto.createDecipheriv('aes-128-cbc', k, Buffer.alloc(16))
          c.setAutoPadding(false)
          const dec = Buffer.concat([c.update(block), c.final()])
          if (isPlausible(dec)) {
            hits++
            console.log(`\n*** HIT  AES-CBC/0IV  ${kLabel}  enc@${encStart}`)
            console.log(`         ${fmtDec(dec)}`)
            console.log(`         dec=${dec.toString('hex')}`)
            console.log(`         mfr=${hex}`)
          }
        } catch {}
      }
    }
  }

  console.log(`\n--- done — ${hits} hit(s) across ${samples.length} sample(s) ---`)
  if (!hits) {
    console.log('No hits. Either:')
    console.log('  1. The samples are stale — restart the server, wait for a Victron ad, then re-run.')
    console.log('  2. The advertisement key is wrong — check VictronConnect → device → settings → ⋮ → Product info → Instant Readout.')
  }
}

// Fetch the latest mfrHex from /diagnostics, then run.
// Falls back to FALLBACK_SAMPLES if the server is not reachable.
function fetchLatestSample(cb) {
  const req = http.get(`http://localhost:${port}/diagnostics`, res => {
    let data = ''
    res.on('data', chunk => { data += chunk })
    res.on('end', () => {
      try {
        const diag = JSON.parse(data)
        cb(null, diag?.solar?.lastMacMatch?.mfrHex ?? null, diag?.solar?.targetMac ?? '')
      } catch (e) {
        cb(e)
      }
    })
  })
  req.setTimeout(2000, () => { req.destroy(); cb(new Error('timeout')) })
  req.on('error', cb)
}

fetchLatestSample((err, liveSample, targetMac) => {
  // MAC: prefer config value, fall back to whatever diagnostics reports
  const mac = cfgMac || (targetMac ?? '').replace(/[^0-9a-f]/gi, '').toLowerCase()

  let samples
  if (err) {
    console.log(`(server not reachable on :${port} — ${err.message}; using fallback samples)`)
    samples = [...FALLBACK_SAMPLES]
  } else if (liveSample) {
    console.log(`Live mfrHex from /diagnostics: ${liveSample}`)
    // prepend live sample; keep fallback samples for comparison coverage
    samples = [liveSample, ...FALLBACK_SAMPLES.filter(s => s !== liveSample)]
  } else {
    console.log(`(server running but no Victron advertisement captured yet; using fallback samples)`)
    samples = [...FALLBACK_SAMPLES]
  }

  if (mac) console.log(`MAC: ${mac}`)
  console.log(`Samples: ${samples.length}\n`)

  runAnalysis(samples, mac)
})
