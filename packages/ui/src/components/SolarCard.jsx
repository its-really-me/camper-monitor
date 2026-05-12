import { Sun } from 'lucide-react'
import { useStale, fmtAge } from '../hooks/useStale'
import { CardOverlay }      from './CardOverlay'

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

function modeBadge(mode) {
  const map = {
    'Bulk':            { bg: 'bg-yellow-900/60',  text: 'text-yellow-300'  },
    'Absorption':      { bg: 'bg-amber-900/60',   text: 'text-amber-400'   },
    'Float':           { bg: 'bg-emerald-900/60', text: 'text-emerald-400' },
    'Equalize':        { bg: 'bg-blue-900/60',    text: 'text-blue-400'    },
    'Auto Equalize':   { bg: 'bg-blue-900/60',    text: 'text-blue-400'    },
    'Fault':           { bg: 'bg-red-900/60',     text: 'text-red-400'     },
    'Off':             { bg: 'bg-slate-700/60',   text: 'text-slate-400'   },
    'Starting Up':     { bg: 'bg-slate-700/60',   text: 'text-slate-400'   },
    'External Control':{ bg: 'bg-purple-900/60',  text: 'text-purple-400'  },
  }
  return map[mode] ?? { bg: 'bg-slate-700/60', text: 'text-slate-400' }
}

function fmtV(v) { return v != null ? `${v} V` : '—' }
function fmtA(a) { return a != null ? `${a} A` : '—' }
function fmtW(w) { return w != null ? `${w} W` : '—' }

export function SolarCard({ solar, connected }) {
  const badge               = modeBadge(solar?.mode)
  const { stale, ageSeconds } = useStale(solar?.ts)

  let overlayTitle = null
  let overlayDetail = null
  if (!solar) {
    overlayTitle  = 'Scanning…'
    overlayDetail = 'Looking for solar charger'
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
        <Sun size={20} className="text-slate-200 shrink-0" />
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-100">Solar Charger</span>
        <span className={`ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full ${connected ? 'bg-emerald-900/60 text-emerald-400' : 'bg-slate-700 text-slate-500'}`}>
          {connected ? 'Live' : 'Offline'}
        </span>
      </div>

      {/* PV section */}
      <div className="flex flex-col gap-1 shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-300">PV Input</span>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Voltage" value={fmtV(solar?.pvVoltage)} color="#facc15" />
          <Stat label="Current" value={fmtA(solar?.pvCurrent)} color="#facc15" />
          <Stat label="Power"   value={fmtW(solar?.pvPower)}   color="#facc15" />
        </div>
      </div>

      <div className="border-t border-slate-700/60" />

      {/* Battery side */}
      <div className="flex flex-col gap-1 flex-1 min-h-0">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-300">Battery Side</span>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Current"    value={fmtA(solar?.batteryCurrent)} color="#60a5fa" />
          <Stat label="Voltage"    value={fmtV(solar?.batteryVoltage)} color="#94a3b8" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Yield today" value={solar ? `${solar.yieldToday} kWh` : '—'} color="#34d399" />
          <Stat label="MPPT"        value={solar?.mpptMode ?? '—'} color="#94a3b8" />
        </div>
      </div>

      {/* Mode badge */}
      <div className={`self-start text-xs font-semibold px-3 py-1 rounded-full ${badge.bg} ${badge.text}`}>
        {solar?.mode ?? '—'}
      </div>
    </div>
  )
}
