/**
 * Camper Monitor — useLiveState.js
 * useLiveState hook — subscribes to the /events SSE stream and returns live state.
 *
 * © 2026 Kai Steuernagel
 */

import { useState, useEffect } from 'react'

export function useLiveState() {
  const [state, setState]       = useState(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    let es

    function connect() {
      es = new EventSource('/events')
      es.onopen    = () => setConnected(true)
      es.onmessage = e => {
        try { setState(JSON.parse(e.data)) } catch { /* ignore malformed frames */ }
      }
      es.onerror   = () => {
        setConnected(false)
        // EventSource retries automatically — no manual reconnect needed
      }
    }

    connect()
    return () => es?.close()
  }, [])

  return { state, connected }
}
