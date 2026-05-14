/**
 * Camper Monitor — main.jsx
 * React entry point — mounts App into #root.
 *
 * © 2026 Kai Steuernagel
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
