import { readFileSync } from 'node:fs'

// Ship the existing same-origin, inline document contract without a browser build step.
const asset = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')
const client = [
  'controls.js',
  'sections.js',
  'getting-started.js',
  'setup-session.js',
  'first-request.js',
  'entry-session.js',
  'entry-views.js',
  'entry-model.js',
  'entry-configure.js',
  'operator-workspace.js',
  'application.js'
]
  .map(asset)
  .join('\n')

export const configurationPage: string = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light"><title>Configuration · AgentHub</title>
<link rel="icon" href="data:,"><style>${asset('configuration.css')}\n${asset('operator-workspace.css')}</style></head>
<body><div id="app"></div><div id="announcer" class="sr-only" role="status" aria-live="polite"></div>
<noscript>Enable JavaScript to configure AgentHub. 请启用 JavaScript 以配置 AgentHub。</noscript>
<script>(() => { 'use strict';\n${client}\n})();</script></body></html>`
