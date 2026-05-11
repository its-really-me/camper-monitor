import { useLiveState } from './hooks/useLiveState'
import { BatteryCard }  from './components/BatteryCard'
import { SolarCard }    from './components/SolarCard'
import { PowerFlow }    from './components/PowerFlow'

function fmt(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString()
}

export default function App() {
  const { state, connected } = useLiveState()

  const lastUpdate = state?.battery?.ts ?? state?.solar?.ts ?? null

  return (
    <div className="h-screen overflow-hidden bg-slate-950 text-slate-100 flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-slate-800 shrink-0">
        <h1 className="text-xl font-bold tracking-tight">Camper Monitor</h1>
        <div className="flex items-center gap-4">
          {lastUpdate && (
            <span className="text-xs text-slate-500">{fmt(lastUpdate)}</span>
          )}
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2.5 h-2.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-500'}`} />
            <span className="text-sm text-slate-400">{connected ? 'Live' : 'Disconnected'}</span>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col gap-3 p-3">
        {/* Cards row */}
        <div className="grid grid-cols-2 gap-3" style={{ minHeight: '260px' }}>
          <BatteryCard
            battery={state?.battery ?? null}
            connected={state?.batteryConnected ?? false}
          />
          <SolarCard
            solar={state?.solar ?? null}
            connected={state?.solarConnected ?? false}
          />
        </div>

        {/* Power flow */}
        <PowerFlow
          battery={state?.battery ?? null}
          solar={state?.solar   ?? null}
        />
      </main>
    </div>
  )
}
