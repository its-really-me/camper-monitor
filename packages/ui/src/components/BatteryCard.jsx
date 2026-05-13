import { Battery } from 'lucide-react'
import { useStale, fmtAge } from '../hooks/useStale'
import { CardOverlay }      from './CardOverlay'

const R = 54
const C = 2 * Math.PI * R          // full circumference ≈ 339.3
const TRACK = C * 0.75             // 270° arc ≈ 254.5

function socColor(soc) {
  if (soc == null) return '#475569'
  if (soc > 50) return '#34d399'   // emerald
  if (soc > 20) return '#fbbf24'   // amber
  return '#f87171'                  // red
}

function SocGauge({ soc }) {
  const pct      = Math.max(0, Math.min(100, soc ?? 0))
  const progress = TRACK * (pct / 100)
  const color    = socColor(soc)

  return (
    <svg viewBox="0 0 140 140" className="w-28 h-28 shrink-0">
      {/* Background track */}
      <circle
        cx={70} cy={70} r={R}
        fill="none"
        stroke="#1e293b"
        strokeWidth={10}
        strokeLinecap="round"
        strokeDasharray={`${TRACK} ${C - TRACK}`}
        transform="rotate(135 70 70)"
      />
      {/* Progress arc */}
      <circle
        cx={70} cy={70} r={R}
        fill="none"
        stroke={color}
        strokeWidth={10}
        strokeLinecap="round"
        strokeDasharray={`${progress} ${C - progress}`}
        transform="rotate(135 70 70)"
        style={{ transition: 'stroke-dasharray 0.6s ease, stroke 0.4s ease' }}
      />
      <text
        x={70} y={70}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={22}
        fontWeight={700}
        fill={color}
      >
        {soc != null ? `${Math.round(soc)}%` : '—'}
      </text>
    </svg>
  )
}

function Stat({ label, value, color }) {
  return (
    <div className="flex flex-col items-center text-center">
      <span className="text-xs text-slate-300 mb-0.5 leading-tight">{label}</span>
      <span className="text-xl font-bold leading-tight" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  )
}

function statusBadge(status) {
  const map = {
    charging:    { label: 'Charging',    bg: 'bg-emerald-900/60', text: 'text-emerald-400' },
    discharging: { label: 'Discharging', bg: 'bg-amber-900/60',   text: 'text-amber-400'   },
    idle:        { label: 'Idle',        bg: 'bg-slate-700/60',   text: 'text-slate-400'   },
  }
  return map[status] ?? { label: status ?? '—', bg: 'bg-slate-700/60', text: 'text-slate-400' }
}

export function BatteryCard({ battery, connected, label = 'Body Battery', compact = false }) {
  const badge               = statusBadge(battery?.status)
  const { stale, ageSeconds } = useStale(battery?.ts)

  let overlayTitle = null
  let overlayDetail = null
  if (!connected && !battery) {
    overlayTitle  = 'Scanning…'
    overlayDetail = 'Looking for device'
  } else if (!connected) {
    overlayTitle  = 'Disconnected'
    overlayDetail = ageSeconds != null ? `Last data ${fmtAge(ageSeconds)} ago` : null
  } else if (stale) {
    overlayTitle  = 'No data'
    overlayDetail = `${fmtAge(ageSeconds)} since last reading`
  }

  return (
    <div className="relative rounded-xl p-3 bg-slate-800/60 border border-slate-700 flex flex-col gap-2 h-full">
      <CardOverlay title={overlayTitle} detail={overlayDetail} />
      {/* Header */}
      <div className="flex items-center gap-2 shrink-0">
        <Battery size={20} className="text-slate-200 shrink-0" />
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-100">{label}</span>
        <span className={`ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full ${connected ? 'bg-emerald-900/60 text-emerald-400' : 'bg-slate-700 text-slate-500'}`}>
          {connected ? 'Live' : 'Offline'}
        </span>
      </div>

      {/* Gauge + stats row */}
      <div className="flex items-center gap-4 flex-1 min-h-0">
        <SocGauge soc={battery?.soc ?? null} />

        <div className="flex flex-col gap-3 flex-1">
          {compact ? (
            <div className="flex flex-col gap-2">
              <Stat label="Voltage" value={battery ? `${battery.voltage} V` : '—'} color="#94a3b8" />
              <Stat label="Temp"    value={battery?.temperature != null ? `${battery.temperature} °C` : '—'} color="#94a3b8" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Voltage" value={battery ? `${battery.voltage} V` : '—'} color="#94a3b8" />
                <Stat label="Current" value={battery ? `${battery.current > 0 ? '+' : ''}${battery.current} A` : '—'} color="#60a5fa" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Power"   value={battery ? `${battery.power} W` : '—'} color="#facc15" />
                <Stat label="Temp"    value={battery?.temperature != null ? `${battery.temperature} °C` : '—'} color="#94a3b8" />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Status badge */}
      <div className={`self-start text-xs font-semibold px-3 py-1 rounded-full ${badge.bg} ${badge.text}`}>
        {badge.label}
      </div>
    </div>
  )
}
