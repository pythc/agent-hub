import {configurationScripts} from './configuration-assets.ts'
import { readFileSync } from 'node:fs'
import {roppoMark} from './account.ts'
import {entryBrandAssets} from './brand-assets.ts'

// Ship the existing same-origin, inline document contract without a browser build step.
const asset = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')
const client = configurationScripts
  .map(asset)
  .join('\n')

export const configurationPage: string = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light dark"><title>Workspace · Roppo</title>
<script>${asset('theme-init.js')}</script>
<link rel="icon" href="${roppoMark}"><style>:root{--roppo-mark:url('${roppoMark}')}\n${asset('configuration.css')}\n${asset('operator-workspace.css')}\n${asset('workspace-settings.css')}\n${asset('affect-ui.css')}\n${asset('flow-motion.css')}\n${asset('execution-page.css')}\n${asset('team-studio.css')}\n${asset('theme.css')}\n${asset('workspace-motion.css')}\n${asset('workflow-story.css')}\n${asset('integrations.css')}</style></head>
<body><div id="app"></div><div id="announcer" class="sr-only" role="status" aria-live="polite"></div>
<noscript>Enable JavaScript to configure AgentHub. 请启用 JavaScript 以配置 AgentHub。</noscript>
<script>(() => { 'use strict';\nconst configurationHost=null;\nconst executionAssets=${JSON.stringify(entryBrandAssets)};\n${client}\n})();</script></body></html>`
