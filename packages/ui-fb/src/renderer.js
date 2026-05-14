/**
 * Camper Monitor — ui-fb/renderer.js
 * Canvas renderer — draws battery, solar, and power flow cards onto a 1024×768 framebuffer.
 *
 * © 2026 Kai Steuernagel
 */

'use strict'

// All measurements in pixels, designed for 1024×768.
// Colors match the React UI (solar-master palette, slate-950 dark theme).

const C = {
  bg:       '#020817',
  cardBg:   'rgba(30,41,59,0.95)',
  border:   '#334155',
  textPri:  '#f1f5f9',
  textSec:  '#94a3b8',
  textMut:  '#475569',
  battery:  '#34d399',
  solar:    '#facc15',
  current:  '#60a5fa',
  load:     '#c084fc',
  red:      '#f87171',
  amber:    '#fbbf24',
}

// SoC gauge arc: 270° sweep, gap at bottom centre
const GAUGE_START = Math.PI * 0.75   // 135° from east (clockwise)
const GAUGE_SWEEP = Math.PI * 1.5    // 270°

function socColor(soc) {
  if (soc == null) return C.textMut
  if (soc > 50)    return C.battery
  if (soc > 20)    return C.amber
  return C.red
}

// ── primitives ───────────────────────────────────────────────────────────────

function roundRect(ctx, x, y, w, h, r = 10) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y,     x + w, y + r,     r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x,     y + h, x,       y + h - r, r)
  ctx.lineTo(x,     y + r)
  ctx.arcTo(x,     y,     x + r,   y,         r)
  ctx.closePath()
}

function card(ctx, x, y, w, h) {
  roundRect(ctx, x, y, w, h)
  ctx.fillStyle = C.cardBg
  ctx.fill()
  ctx.strokeStyle = C.border
  ctx.lineWidth = 1
  ctx.stroke()
}

function label(ctx, text, x, y, { size = 12, color = C.textMut, bold = false, align = 'left' } = {}) {
  ctx.font = `${bold ? 'bold ' : ''}${size}px sans-serif`
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y)
  ctx.textAlign = 'left'
}

function stat(ctx, lbl, value, x, y, valueColor = C.textSec) {
  label(ctx, lbl, x, y - 10, { size: 11, color: C.textMut })
  label(ctx, value ?? '—', x, y + 10, { size: 20, bold: true, color: valueColor })
}

function badge(ctx, text, x, y, bg, fg) {
  ctx.font = 'bold 12px sans-serif'
  const tw  = ctx.measureText(text).width
  const pad = 10
  const bw  = tw + pad * 2
  const bh  = 22
  roundRect(ctx, x, y - bh / 2, bw, bh, 5)
  ctx.fillStyle = bg
  ctx.fill()
  label(ctx, text, x + pad, y, { size: 12, bold: true, color: fg })
}

// ── header ───────────────────────────────────────────────────────────────────

function drawHeader(ctx, W, connected, lastTs) {
  ctx.fillStyle = '#0f172a'
  ctx.fillRect(0, 0, W, 60)

  label(ctx, 'Camper Monitor', 24, 30, { size: 22, bold: true, color: C.textPri })

  if (lastTs) {
    label(ctx, new Date(lastTs).toLocaleTimeString(), W - 160, 30, { size: 14, color: C.textMut, align: 'right' })
  }

  ctx.beginPath()
  ctx.arc(W - 100, 30, 6, 0, Math.PI * 2)
  ctx.fillStyle = connected ? C.battery : C.red
  ctx.fill()
  label(ctx, connected ? 'Live' : 'Offline', W - 88, 30, { size: 14, color: C.textSec })
}

// ── SoC gauge ────────────────────────────────────────────────────────────────

function drawGauge(ctx, cx, cy, soc) {
  const R    = 68
  const LW   = 12
  const end  = GAUGE_START + GAUGE_SWEEP * (Math.max(0, Math.min(100, soc ?? 0)) / 100)
  const col  = socColor(soc)

  ctx.lineCap   = 'round'
  ctx.lineWidth = LW

  ctx.beginPath()
  ctx.arc(cx, cy, R, GAUGE_START, GAUGE_START + GAUGE_SWEEP, false)
  ctx.strokeStyle = '#1e293b'
  ctx.stroke()

  if (soc != null && soc > 0) {
    ctx.beginPath()
    ctx.arc(cx, cy, R, GAUGE_START, end, false)
    ctx.strokeStyle = col
    ctx.stroke()
  }

  label(ctx, soc != null ? `${Math.round(soc)}%` : '—', cx, cy, {
    size: 28, bold: true, color: col, align: 'center',
  })
}

// ── card overlay ─────────────────────────────────────────────────────────────

function fmtAge(s) {
  if (s < 60)   return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}min`
  return `${Math.round(s / 3600)}h`
}

function cardOverlay(ctx, title, detail, x, y, w, h) {
  roundRect(ctx, x, y, w, h)
  ctx.fillStyle = 'rgba(2,8,23,0.82)'
  ctx.fill()
  const cy = y + h / 2
  label(ctx, '⚠', x + w / 2, cy - 22, { size: 18, color: C.amber, align: 'center' })
  label(ctx, title,  x + w / 2, cy + 2,  { size: 16, bold: true, color: C.textPri, align: 'center' })
  if (detail) {
    label(ctx, detail, x + w / 2, cy + 22, { size: 12, color: C.textSec, align: 'center' })
  }
}

function overlayMessage(connected, lastTs) {
  if (!connected && !lastTs) return { title: 'Scanning…', detail: null }
  if (!connected) {
    const s = Math.round((Date.now() - lastTs) / 1000)
    return { title: 'Disconnected', detail: `Last data ${fmtAge(s)} ago` }
  }
  if (Date.now() - lastTs > 30_000) {
    const s = Math.round((Date.now() - lastTs) / 1000)
    return { title: 'No data', detail: `${fmtAge(s)} since last reading` }
  }
  return null
}

// ── battery card ─────────────────────────────────────────────────────────────

const STATUS_BADGE = {
  charging:    { bg: 'rgba(6,78,59,0.85)',  fg: C.battery, text: 'CHARGING'    },
  discharging: { bg: 'rgba(78,50,6,0.85)', fg: C.amber,   text: 'DISCHARGING' },
  idle:        { bg: 'rgba(30,41,59,0.85)',fg: C.textSec, text: 'IDLE'        },
}

function drawBatteryCard(ctx, battery, connected, x, y, w, h) {
  card(ctx, x, y, w, h)
  label(ctx, 'BATTERY', x + 16, y + 20, { size: 11, bold: true })

  if (battery) {
    drawGauge(ctx, x + 108, y + h / 2, battery.soc)

    const sx = x + 210
    const sy = y + 70

    stat(ctx, 'Voltage',  battery.voltage  != null ? `${battery.voltage} V`  : null, sx,       sy,       C.textSec)
    stat(ctx, 'Current',  battery.current  != null ? `${battery.current > 0 ? '+' : ''}${battery.current} A` : null, sx + 130, sy,       C.current)
    stat(ctx, 'Power',    battery.power    != null ? `${battery.power} W`    : null, sx,       sy + 75,  C.solar)
    stat(ctx, 'Temp',     battery.temperature != null ? `${battery.temperature} °C` : null, sx + 130, sy + 75,  C.textSec)

    const b = STATUS_BADGE[battery.status] ?? STATUS_BADGE.idle
    badge(ctx, b.text, x + 16, y + h - 20, b.bg, b.fg)
  }

  const ov = overlayMessage(connected, battery?.ts ?? null)
  if (ov) cardOverlay(ctx, ov.title, ov.detail, x, y, w, h)
}

// ── solar card ───────────────────────────────────────────────────────────────

const MODE_BADGE = {
  'Bulk':        { bg: 'rgba(66,51,6,0.85)',  fg: C.solar   },
  'Absorption':  { bg: 'rgba(66,40,6,0.85)',  fg: '#f97316' },
  'Float':       { bg: 'rgba(6,78,59,0.85)',  fg: C.battery },
  'Equalize':    { bg: 'rgba(6,29,78,0.85)',  fg: C.current },
  'Auto Equalize':{ bg: 'rgba(6,29,78,0.85)', fg: C.current },
  'Off':         { bg: 'rgba(30,41,59,0.85)', fg: C.textMut },
  'Starting Up': { bg: 'rgba(30,41,59,0.85)', fg: C.textMut },
  'Fault':       { bg: 'rgba(78,6,6,0.85)',   fg: C.red     },
}

function drawSolarCard(ctx, solar, connected, x, y, w, h) {
  card(ctx, x, y, w, h)
  label(ctx, 'SOLAR CHARGER', x + 16, y + 20, { size: 11, bold: true })

  if (solar) {
    label(ctx, 'PV INPUT', x + 16, y + 48, { size: 10, bold: true, color: '#475569' })

    stat(ctx, 'Voltage', solar.pvVoltage != null ? `${solar.pvVoltage} V` : null, x + 16,  y + 75,  C.solar)
    stat(ctx, 'Current', solar.pvCurrent != null ? `${solar.pvCurrent} A` : null, x + 145, y + 75,  C.solar)
    stat(ctx, 'Power',   solar.pvPower   != null ? `${solar.pvPower} W`   : null, x + 275, y + 75,  C.solar)

    ctx.beginPath()
    ctx.moveTo(x + 16, y + 148)
    ctx.lineTo(x + w - 16, y + 148)
    ctx.strokeStyle = C.border
    ctx.lineWidth = 1
    ctx.stroke()

    label(ctx, 'BATTERY SIDE', x + 16, y + 162, { size: 10, bold: true, color: '#475569' })

    stat(ctx, 'Current',     solar.batteryCurrent != null ? `${solar.batteryCurrent} A`   : null, x + 16,  y + 189, C.current)
    stat(ctx, 'Voltage',     solar.batteryVoltage != null ? `${solar.batteryVoltage} V`   : null, x + 145, y + 189, C.textSec)
    stat(ctx, 'Yield today', solar.yieldToday     != null ? `${solar.yieldToday} kWh`     : null, x + 275, y + 189, C.battery)

    const mb = MODE_BADGE[solar.mode] ?? { bg: 'rgba(30,41,59,0.85)', fg: C.textSec }
    badge(ctx, solar.mode ?? '—', x + 16, y + h - 20, mb.bg, mb.fg)
  }

  // Solar BLE reader emits 'connected' on startup before finding the device,
  // so show Scanning whenever there is no data regardless of connected state.
  const ov = !solar
    ? { title: 'Scanning…', detail: null }
    : overlayMessage(connected, solar.ts)
  if (ov) cardOverlay(ctx, ov.title, ov.detail, x, y, w, h)
}

// ── power flow ───────────────────────────────────────────────────────────────

function flowNode(ctx, cx, cy, r, color, topLabel, botLabel) {
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = color + '22'
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.stroke()
  label(ctx, topLabel, cx, cy - 4, { size: 12, bold: true, color, align: 'center' })
  label(ctx, botLabel,  cx, cy + 14, { size: 11, color: C.textSec, align: 'center' })
}

function flowArrow(ctx, x1, y, x2, active, color, text) {
  ctx.setLineDash(active ? [14, 7] : [4, 4])
  ctx.beginPath()
  ctx.moveTo(x1, y)
  ctx.lineTo(x2, y)
  ctx.strokeStyle = active ? color : C.border
  ctx.lineWidth   = active ? 3 : 1.5
  ctx.stroke()
  ctx.setLineDash([])

  if (active) {
    const tip = 10
    ctx.beginPath()
    ctx.moveTo(x2, y)
    ctx.lineTo(x2 - tip, y - 5)
    ctx.lineTo(x2 - tip, y + 5)
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()

    label(ctx, text, (x1 + x2) / 2, y - 14, { size: 12, bold: true, color, align: 'center' })
  }
}

function drawPowerFlow(ctx, battery, solar, x, y, w, h) {
  card(ctx, x, y, w, h)
  label(ctx, 'POWER FLOW', x + 16, y + 20, { size: 11, bold: true })

  const pvPower  = solar?.pvPower  ?? 0
  const loadPow  = battery?.status === 'discharging' ? (battery?.power ?? 0) : 0
  const THRESH   = 5
  const nodeY    = y + h / 2 + 8
  const R        = 36

  const solarX   = x + w * 0.18
  const battX    = x + w * 0.50
  const loadX    = x + w * 0.82

  flowArrow(ctx, solarX + R, nodeY, battX - R, pvPower > THRESH, C.solar, `${pvPower} W`)
  flowArrow(ctx, battX  + R, nodeY, loadX - R, loadPow > THRESH, C.load,  `${Math.round(loadPow)} W`)

  flowNode(ctx, solarX, nodeY, R, C.solar,   'PV',      solar   ? `${pvPower} W`            : '—')
  flowNode(ctx, battX,  nodeY, R, C.battery, 'Battery', battery ? `${battery.soc ?? '—'}%`  : '—')
  flowNode(ctx, loadX,  nodeY, R, C.load,    'Load',    loadPow > THRESH ? `${Math.round(loadPow)} W` : '—')
}

// ── main render ──────────────────────────────────────────────────────────────

function render(ctx, W, H, state, connected) {
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, W, H)

  const lastTs = state?.battery?.ts ?? state?.solar?.ts ?? null
  drawHeader(ctx, W, connected, lastTs)

  const M      = 20
  const TOP    = 72
  const CARDH  = 295
  const cardW  = (W - M * 3) / 2

  drawBatteryCard(ctx, state?.battery ?? null, state?.batteryConnected ?? false, M,             TOP, cardW, CARDH)
  drawSolarCard(  ctx, state?.solar   ?? null, state?.solarConnected   ?? false, M * 2 + cardW, TOP, cardW, CARDH)
  drawPowerFlow(  ctx, state?.battery ?? null, state?.solar ?? null,
                  M, TOP + CARDH + M, W - M * 2, 175)
}

module.exports = { render }
