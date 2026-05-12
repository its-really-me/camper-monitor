import { useState, useEffect } from 'react'

export function fmtAge(seconds) {
  if (seconds < 60)   return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}min`
  return `${Math.round(seconds / 3600)}h`
}

export function useStale(ts, thresholdMs = 30_000) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(id)
  }, [])

  if (!ts) return { stale: false, ageSeconds: null }
  const ageSeconds = Math.round((now - ts) / 1000)
  return { stale: ageSeconds * 1000 >= thresholdMs, ageSeconds }
}
