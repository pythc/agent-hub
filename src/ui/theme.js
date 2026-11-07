function updateThemeButtons() {
  const dark = document.documentElement.dataset.theme === 'dark'
  for (const button of document.querySelectorAll('[data-theme-toggle]')) {
    button.setAttribute('aria-label', L('Dark mode', '深色模式'))
    button.setAttribute('aria-pressed', String(dark))
    button.title = dark ? L('Switch to light mode', '切换为浅色模式') : L('Switch to dark mode', '切换为深色模式')
    button.replaceChildren(icon(dark ? 'sun' : 'moon'))
  }
}
function applyTheme(theme) {
  const root = document.documentElement
  root.dataset.themeSwitching = ''
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light'
  updateThemeButtons()
  // Apply foreground and background together, then restore interaction transitions.
  void getComputedStyle(root).color
  requestAnimationFrame(() => requestAnimationFrame(() => { delete root.dataset.themeSwitching }))
}
function themeToggle() {
  const button = el('button', 'theme-toggle')
  button.type = 'button'
  button.dataset.themeToggle = ''
  const dark = document.documentElement.dataset.theme === 'dark'
  button.setAttribute('aria-label', L('Dark mode', '深色模式'))
  button.setAttribute('aria-pressed', String(dark))
  button.title = dark ? L('Switch to light mode', '切换为浅色模式') : L('Switch to dark mode', '切换为深色模式')
  button.append(icon(dark ? 'sun' : 'moon'))
  button.onclick = () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
    // Change only the palette: drafts, dialogs, focus and live Calls stay mounted.
    applyTheme(theme)
    try { localStorage.setItem('agenthub.configuration.theme', theme) } catch {}
  }
  return button
}
window.addEventListener('storage', event => {
  if (event.key === 'agenthub.configuration.theme' || event.key === null) applyTheme(event.newValue)
})
