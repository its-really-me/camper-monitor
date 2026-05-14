/**
 * Camper Monitor — App.jsx
 * Root React component — layout, SSE connection, language context.
 *
 * © 2026 Kai Steuernagel
 */

import { useLiveState } from './hooks/useLiveState'
import { BatteryCard }  from './components/BatteryCard'
import { SolarCard }    from './components/SolarCard'
import { PowerFlow }    from './components/PowerFlow'
import { LangContext, buildT, useT } from './i18n'

function fmt(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString()
}

export default function App() {
  const { state, connected } = useLiveState()

  const lang       = state?.language ?? 'en'
  const t          = buildT(lang)
  const lastUpdate = state?.battery?.ts ?? state?.solar?.ts ?? null
  const hasStarter = state != null && 'starter' in state

  return (
    <LangContext.Provider value={t}>
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
              <span className="text-sm text-slate-400">{connected ? t('live') : t('disconnected')}</span>
            </div>
          </div>
        </header>

        {/* Main */}
        <main className="flex-1 flex flex-col gap-2 p-3 min-h-0">
          <div className={`grid ${hasStarter ? 'grid-cols-3' : 'grid-cols-2'} gap-3 flex-1 min-h-0`}>
            <BatteryCard
              battery={state?.battery ?? null}
              connected={state?.batteryConnected ?? false}
              label={t('bodyBattery')}
            />
            <SolarCard
              solar={state?.solar ?? null}
              connected={state?.solarConnected ?? false}
            />
            {hasStarter && (
              <BatteryCard
                battery={state.starter}
                connected={state.starterConnected ?? false}
                label={t('starterBattery')}
                compact
              />
            )}
          </div>

          <PowerFlow
            battery={state?.battery ?? null}
            solar={state?.solar   ?? null}
          />
        </main>
      </div>
    </LangContext.Provider>
  )
}
