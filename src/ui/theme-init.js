// Apply the saved choice before the page paints. A missing or inaccessible preference defaults to white.
(() => {
  let theme = 'light'
  try { if (localStorage.getItem('agenthub.configuration.theme') === 'dark') theme = 'dark' } catch {}
  document.documentElement.dataset.theme = theme
})()
