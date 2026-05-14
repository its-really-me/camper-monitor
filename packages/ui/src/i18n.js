/**
 * Camper Monitor — i18n.js
 * Translation strings and context for English / German UI language support.
 *
 * © 2026 Kai Steuernagel
 */

import { createContext, useContext } from 'react'

const strings = {
  en: {
    // card labels
    bodyBattery:       'Body Battery',
    starterBattery:    'Starter Battery',
    solarCharger:      'Solar Charger',
    powerFlow:         'Power Flow',
    // stat labels
    voltage:           'Voltage',
    current:           'Current',
    power:             'Power',
    temp:              'Temp',
    yieldToday:        'Yield today',
    mppt:              'MPPT',
    pvInput:           'PV Input',
    batterySide:       'Battery Side',
    // connection badges
    live:              'Live',
    offline:           'Offline',
    // battery status
    charging:          'Charging',
    discharging:       'Discharging',
    idle:              'Idle',
    // overlays (use {age} placeholder where needed)
    scanning:          'Scanning…',
    lookingForDevice:  'Looking for device',
    lookingForSolar:   'Looking for solar charger',
    disconnected:      'Disconnected',
    lastDataAgo:       'Last data {age} ago',
    noData:            'No data',
    sinceLastReading:  '{age} since last reading',
    // power flow nodes
    pv:                'PV',
    battery:           'Battery',
    load:              'Load',
    // solar charge modes
    modeBulk:          'Bulk',
    modeAbsorption:    'Absorption',
    modeFloat:         'Float',
    modeEqualize:      'Equalize',
    modeAutoEqualize:  'Auto Equalize',
    modeOff:           'Off',
    modeStartingUp:    'Starting Up',
    modeFault:         'Fault',
    modeExtControl:    'External Control',
    modeUnknown:       'Unknown',
  },
  de: {
    // card labels
    bodyBattery:       'Bordbatterie',
    starterBattery:    'Starterbatterie',
    solarCharger:      'Solarladeregler',
    powerFlow:         'Leistungsfluss',
    // stat labels
    voltage:           'Spannung',
    current:           'Strom',
    power:             'Leistung',
    temp:              'Temp',
    yieldToday:        'Ertrag heute',
    mppt:              'MPPT',
    pvInput:           'PV Eingang',
    batterySide:       'Batterieseite',
    // connection badges
    live:              'Live',
    offline:           'Offline',
    // battery status
    charging:          'Laden',
    discharging:       'Entladen',
    idle:              'Standby',
    // overlays
    scanning:          'Suche…',
    lookingForDevice:  'Gerät wird gesucht',
    lookingForSolar:   'Solarladeregler wird gesucht',
    disconnected:      'Getrennt',
    lastDataAgo:       'Letzte Daten vor {age}',
    noData:            'Keine Daten',
    sinceLastReading:  '{age} ohne Signal',
    // power flow nodes
    pv:                'PV',
    battery:           'Batterie',
    load:              'Verbraucher',
    // solar charge modes
    modeBulk:          'Bulk-Laden',
    modeAbsorption:    'Absorption',
    modeFloat:         'Erhaltung',
    modeEqualize:      'Ausgleichsladen',
    modeAutoEqualize:  'Auto-Ausgleich',
    modeOff:           'Aus',
    modeStartingUp:    'Startet…',
    modeFault:         'Fehler',
    modeExtControl:    'Extern',
    modeUnknown:       'Unbekannt',
  },
}

// Map solar mode strings (from reader) to i18n keys
export const SOLAR_MODE_KEY = {
  'Bulk':             'modeBulk',
  'Absorption':       'modeAbsorption',
  'Float':            'modeFloat',
  'Equalize':         'modeEqualize',
  'Auto Equalize':    'modeAutoEqualize',
  'Off':              'modeOff',
  'Starting Up':      'modeStartingUp',
  'Fault':            'modeFault',
  'External Control': 'modeExtControl',
}

const defaultT = buildT('en')

export const LangContext = createContext(defaultT)

export function useT() {
  return useContext(LangContext)
}

export function buildT(lang) {
  const dict = strings[lang] ?? strings.en
  return function t(key, vars = {}) {
    let s = dict[key] ?? strings.en[key] ?? key
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v)
    return s
  }
}
