import { readFileSync } from 'node:fs'
const asset = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')
export const roppoMark =
  'data:image/png;base64,' +
  readFileSync(new URL('assets/roppo-mark.png', import.meta.url)).toString('base64')
export const accountPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark"><title>Roppo</title>
<script>${asset('theme-init.js')}</script><link rel="icon" href="${roppoMark}">
<style>:root{--roppo-mark:url('${roppoMark}')}\n${asset('auth-page.css')}</style></head>
<body><div id="account-app"><p class="boot-message" role="status">Opening Roppo…</p></div><noscript>Enable JavaScript to open your workspace. 请启用 JavaScript 以进入工作区。</noscript>
<script>(()=>{'use strict';\n${asset('auth-page.js')}\n})();</script></body></html>`
