'use strict'

// Writes a node-canvas raw buffer (Cairo BGRA, little-endian) to /dev/fb0.
// Supports 16-bit RGB565 and 32-bit ARGB framebuffers.

const fs = require('fs')

function readSysInt(file, fallback) {
  try { return parseInt(fs.readFileSync(file, 'utf8').trim(), 10) }
  catch { return fallback }
}

function getScreenSize() {
  const w = readSysInt('/sys/class/graphics/fb0/virtual_size', null)
  if (w === null) return { width: 1024, height: 768 }
  // virtual_size is "WIDTHxHEIGHT" not "WIDTH,HEIGHT" on some kernels
  try {
    const raw = fs.readFileSync('/sys/class/graphics/fb0/virtual_size', 'utf8').trim()
    const [width, height] = raw.split(/[x,]/).map(Number)
    return { width, height }
  } catch {
    return { width: 1024, height: 768 }
  }
}

// Cairo raw = BGRA (4 bytes per pixel, little-endian ARGB32)
function bgraToRgb565(src) {
  const pixels = src.length / 4
  const dst    = Buffer.alloc(pixels * 2)
  for (let i = 0; i < pixels; i++) {
    const b = src[i * 4]     >> 3
    const g = src[i * 4 + 1] >> 2
    const r = src[i * 4 + 2] >> 3
    dst.writeUInt16LE((r << 11) | (g << 5) | b, i * 2)
  }
  return dst
}

class Framebuffer {
  constructor(device = '/dev/fb0') {
    this.bpp    = readSysInt('/sys/class/graphics/fb0/bits_per_pixel', 32)
    this.size   = getScreenSize()
    this.fd     = fs.openSync(device, 'w')
    console.log(`[ui-fb] framebuffer ${this.size.width}×${this.size.height} @ ${this.bpp} bpp`)
  }

  write(bgraData) {
    const buf = this.bpp === 16 ? bgraToRgb565(bgraData) : bgraData
    fs.writeSync(this.fd, buf, 0, buf.length, 0)
  }

  close() { fs.closeSync(this.fd) }
}

module.exports = { Framebuffer, getScreenSize }
