/**
 * Camper Monitor — useStale.js
 * useStale hook — detects readings older than a threshold and returns age in seconds.
 *
 * © 2026 Kai Steuernagel
 */

import { useState, useEffect } from 'react'

export function fmtAge(seconds) {
  if (seconds < 60)   return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}min`
  return `${Math.round(seconds / 3600)}h`
}

// warn  — data older than 2 missed polls: show age indicator, keep data visible
// overlay — data older than 5 missed polls: show blocking overlay
export function useStale(ts, pollInterval = 15_000) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000)
    return () => clearInterval(id)
  }, [])

  if (!ts) return { warn: false, overlay: false, ageSeconds: null }
  const ageMs      = now - ts
  const ageSeconds = Math.round(ageMs / 1000)
  return {
    warn:    ageMs >= 2 * pollInterval,
    overlay: ageMs >= 5 * pollInterval,
    ageSeconds,
  }
}
