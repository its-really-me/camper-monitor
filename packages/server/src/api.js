'use strict'

const path    = require('path')
const fs      = require('fs')
const express = require('express')

const UI_DIST = path.resolve(__dirname, '../../ui/dist')

function createApi(state) {
  const app     = express()
  const clients = new Set()

  // Allow Vite dev server to call the API
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    next()
  })

  // Serve built UI when it exists (production / Pi)
  if (fs.existsSync(UI_DIST)) {
    app.use(express.static(UI_DIST))
  }

  function push(data) {
    const payload = `data: ${JSON.stringify(data)}\n\n`
    for (const res of clients) res.write(payload)
  }

  app.get('/events', (req, res) => {
    res.setHeader('Content-Type',  'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection',    'keep-alive')
    res.flushHeaders()

    // Send current state immediately so the UI doesn't wait for first tick
    res.write(`data: ${JSON.stringify(state.toJSON())}\n\n`)

    clients.add(res)
    req.on('close', () => clients.delete(res))
  })

  app.get('/state', (_req, res) => res.json(state.toJSON()))

  // SPA fallback (must be last)
  if (fs.existsSync(UI_DIST)) {
    app.get('*', (_req, res) => res.sendFile(path.join(UI_DIST, 'index.html')))
  }

  return { app, push }
}

module.exports = { createApi }
