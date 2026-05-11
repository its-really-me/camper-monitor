'use strict'

const fs                = require('fs')
const { execFileSync }  = require('child_process')

let createCanvas
try {
  createCanvas = require('canvas').createCanvas
} catch {
  console.error('[ui-fb] ERROR: "canvas" package not found.')
  console.error('  Install system deps:  sudo apt install -y libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev')
  console.error('  Then:                 npm install')
  process.exit(1)
}

const http              = require('http')
const { Framebuffer, getScreenSize } = require('./framebuffer')
const { render }        = require('./renderer')

const { width: W, height: H } = getScreenSize()
const canvas = createCanvas(W, H)
const ctx    = canvas.getContext('2d')

let state     = null
let connected = false
let blanked   = false

// Hide the terminal cursor that bleeds through the framebuffer from tty1
try { fs.writeFileSync('/dev/tty1', '\x1b[?25l') } catch {}

// Open framebuffer — gracefully degrade if not available (e.g. dev machine)
let fb = null
try {
  fb = new Framebuffer('/dev/fb0')
} catch (e) {
  console.warn('[ui-fb] Cannot open /dev/fb0:', e.message)
  console.warn('[ui-fb] Rendering without framebuffer output (dry run).')
}

// ── screen blanking ──────────────────────────────────────────────────────────

const BLANK_TIMEOUT_MIN = parseInt(process.env.BLANK_TIMEOUT ?? '3', 10)
const TOUCH_DEVICE      = process.env.TOUCH_DEVICE ?? '/dev/input/event0'
const BLANK_MS          = BLANK_TIMEOUT_MIN * 60 * 1000

function setBlank(on) {
  // vcgencmd works for members of the video group (no root needed);
  // sysfs fallback requires root and will warn if it fails
  try {
    execFileSync('vcgencmd', ['display_power', on ? '0' : '1'], { timeout: 2000 })
  } catch {
    try { fs.writeFileSync('/sys/class/graphics/fb0/blank', on ? '1' : '0') } catch (e) {
      console.warn(`[ui-fb] Cannot blank display: ${e.message}`)
    }
  }
  blanked = on
  console.log(`[ui-fb] Display ${on ? 'blanked' : 'unblanked'}`)
}

let blankTimer = null

function resetIdleTimer() {
  if (blanked) { setBlank(false); draw() }
  clearTimeout(blankTimer)
  if (BLANK_MS > 0) blankTimer = setTimeout(() => setBlank(true), BLANK_MS)
}

if (BLANK_MS > 0) {
  // fs.read on a char device blocks in libuv's thread pool until an event
  // arrives — correct pattern for /dev/input/event* on Linux
  const buf = Buffer.alloc(64)
  const readTouch = fd => fs.read(fd, buf, 0, buf.length, null, (err, n) => {
    if (!err && n > 0) { resetIdleTimer(); readTouch(fd) }
  })
  fs.open(TOUCH_DEVICE, 'r', (err, fd) => {
    if (err) {
      console.warn(`[ui-fb] Touch device (${TOUCH_DEVICE}): ${err.message}`)
    } else {
      console.log(`[ui-fb] Screen blanks after ${BLANK_TIMEOUT_MIN} min idle (${TOUCH_DEVICE})`)
      readTouch(fd)
    }
  })
  resetIdleTimer()
}

function draw() {
  if (blanked) return
  render(ctx, W, H, state, connected)
  if (fb) {
    fb.write(canvas.toBuffer('raw'))   // raw = Cairo BGRA
  }
}

// ── SSE client ───────────────────────────────────────────────────────────────

function connectSSE(url) {
  const req = http.get(url, res => {
    if (res.statusCode !== 200) {
      console.error(`[ui-fb] SSE returned ${res.statusCode} — retrying in 5 s…`)
      res.resume()
      setTimeout(() => connectSSE(url), 5000)
      return
    }

    connected = true
    draw()

    let buf = ''
    res.on('data', chunk => {
      buf += chunk.toString()
      const lines = buf.split('\n')
      buf = lines.pop()          // keep incomplete last line
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            state = JSON.parse(line.slice(6))
            draw()
          } catch { /* ignore malformed frames */ }
        }
      }
    })

    res.on('end', () => {
      connected = false
      console.log('[ui-fb] SSE stream ended — reconnecting in 3 s…')
      draw()
      setTimeout(() => connectSSE(url), 3000)
    })

    res.on('error', err => {
      connected = false
      console.error('[ui-fb] SSE error:', err.message)
      draw()
    })
  })

  req.on('error', err => {
    connected = false
    console.warn(`[ui-fb] Cannot reach server (${err.message}) — retrying in 5 s…`)
    draw()
    setTimeout(() => connectSSE(url), 5000)
  })

  req.setTimeout(0) // disable socket timeout — SSE is a persistent connection
}

// ── start ────────────────────────────────────────────────────────────────────

const port = process.env.PORT ?? 3000
const url  = `http://localhost:${port}/events`

console.log(`[ui-fb] ${W}×${H} — connecting to ${url}`)
draw()               // render "offline" frame immediately
connectSSE(url)

// Periodic refresh so the clock updates even when data is static
setInterval(draw, 15_000)

process.on('SIGINT', () => {
  fb?.close()
  process.exit(0)
})
