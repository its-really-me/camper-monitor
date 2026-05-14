/**
 * Camper Monitor — PowerFlow.jsx
 * Animated power flow diagram — SVG arrows for PV → Battery → Load.
 *
 * © 2026 Kai Steuernagel
 */

import { useT } from '../i18n'

const W = 420
const H = 160
const THRESHOLD = 5

function fmtW(w) {
  if (w == null) return '—'
  return Math.abs(w) >= 1000
    ? `${(Math.abs(w) / 1000).toFixed(1)} kW`
    : `${Math.abs(Math.round(w))} W`
}

function NodeIcon({ cx, cy, color, type }) {
  const s = 16
  const x = cx - s / 2
  const y = cy - s / 2 - 6
  return (
    <svg x={x} y={y} width={s} height={s} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    >
      {type === 'sun' && <>
        <circle cx="12" cy="12" r="4" />
        <line x1="12" y1="2"  x2="12" y2="5"  />
        <line x1="12" y1="19" x2="12" y2="22" />
        <line x1="2"  y1="12" x2="5"  y2="12" />
        <line x1="19" y1="12" x2="22" y2="12" />
        <line x1="4.9"  y1="4.9"  x2="7.1"  y2="7.1"  />
        <line x1="16.9" y1="16.9" x2="19.1" y2="19.1" />
        <line x1="19.1" y1="4.9"  x2="16.9" y2="7.1"  />
        <line x1="7.1"  y1="16.9" x2="4.9"  y2="19.1" />
      </>}
      {type === 'battery' && <>
        <rect x="2" y="7" width="16" height="10" rx="2" />
        <line x1="22" y1="11" x2="22" y2="13" />
      </>}
      {type === 'zap' && (
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill={color} fillOpacity="0.8" />
      )}
    </svg>
  )
}

function Node({ cx, cy, color, label, subLabel, icon }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={34} fill={color} fillOpacity={0.12} stroke={color} strokeWidth={2} />
      <NodeIcon cx={cx} cy={cy} color={color} type={icon} />
      <text x={cx} y={cy + 14} textAnchor="middle" fontSize="9.5" fontWeight="700" fill={color}>{label}</text>
      {subLabel && (
        <text x={cx} y={cy + 26} textAnchor="middle" fontSize="9.5" fill="#94a3b8">{subLabel}</text>
      )}
    </g>
  )
}

function Arrow({ x1, y1, x2, y2, power, color }) {
  const active = power != null && Math.abs(power) > THRESHOLD
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  return (
    <g>
      <line
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={active ? color : '#334155'}
        strokeWidth={active ? 3 : 1.5}
        strokeDasharray={active ? '16 8' : '4 4'}
        strokeLinecap="round"
        style={active ? { animation: 'flow 1.2s linear infinite' } : {}}
      />
      {active && (
        <text x={mx} y={my - 8} textAnchor="middle" fontSize="11" fontWeight="600" fill={color}>
          {fmtW(power)}
        </text>
      )}
    </g>
  )
}

export function PowerFlow({ battery, solar }) {
  const t = useT()

  const pvPower    = solar?.pvPower ?? null
  const battCharge = solar?.batteryCurrent != null && solar.batteryCurrent > 0
    ? solar.batteryCurrent * (solar.batteryVoltage ?? 12.6)
    : null
  const loadPower  = battery?.status === 'discharging' ? battery.power : null

  const NODES = {
    solar:   { cx: 60,  cy: 80, color: '#facc15', label: t('pv'),      icon: 'sun'     },
    battery: { cx: 210, cy: 80, color: '#34d399', label: t('battery'), icon: 'battery' },
    load:    { cx: 360, cy: 80, color: '#c084fc', label: t('load'),    icon: 'zap'     },
  }

  const { solar: sn, battery: bn, load: ln } = NODES

  return (
    <div className="rounded-xl p-3 bg-slate-800/60 border border-slate-700">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 block mb-2">
        {t('powerFlow')}
      </span>
      <div className="flex justify-center">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-lg" style={{ overflow: 'visible' }}>
          <style>{`@keyframes flow { to { stroke-dashoffset: -24; } }`}</style>

          <Arrow x1={sn.cx + 35} y1={sn.cy} x2={bn.cx - 35} y2={bn.cy}
            power={pvPower} color={sn.color} />
          <Arrow x1={bn.cx + 35} y1={bn.cy} x2={ln.cx - 35} y2={ln.cy}
            power={loadPower} color={ln.color} />

          <Node {...sn} subLabel={fmtW(pvPower)} />
          <Node {...bn} subLabel={`${battery?.soc ?? '—'}%`} />
          <Node {...ln} subLabel={fmtW(loadPower)} />
        </svg>
      </div>
    </div>
  )
}
