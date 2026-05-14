/**
 * Camper Monitor — CardOverlay.jsx
 * Card overlay — dimmed backdrop for disconnected / no-data states.
 *
 * © 2026 Kai Steuernagel
 */

import { AlertTriangle } from 'lucide-react'

export function CardOverlay({ title, detail }) {
  if (!title) return null
  return (
    <div className="absolute inset-0 rounded-xl z-10 flex flex-col items-center justify-center gap-1.5 bg-slate-900/80 backdrop-blur-[2px]">
      <AlertTriangle size={20} className="text-amber-400" />
      <span className="text-sm font-semibold text-slate-200">{title}</span>
      {detail && <span className="text-xs text-slate-400">{detail}</span>}
    </div>
  )
}
