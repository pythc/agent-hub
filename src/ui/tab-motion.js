// Shared by the React shell and the standalone configuration document.
// Observe committed selection only; never delay navigation, remount content or write application state.
;(() => {
  const key = Symbol.for('roppo.tab-motion')
  if (globalThis[key]) return
  const media = matchMedia('(prefers-reduced-motion: reduce)')
  const easing = 'cubic-bezier(.22,1,.36,1)'
  const groups = new Map(), animations = new Map(), observed = new Set()
  let frame = 0, route = null, disposed = false
  const visible = node => !!node?.isConnected && node.getClientRects().length > 0
  const following = node => {
    const nodes = []
    for (let next = node.nextElementSibling; next; next = next.nextElementSibling)
      if (!next.matches('nav,dialog,[role=tablist]')) nodes.push(next)
    return nodes
  }
  // Explicit adapters keep nested tabs independent and exclude ordinary buttons and live data.
  const adapters = [
    { selector: '.workspace-tabs', panels: following },
    { selector: '.memory-file-tabs', panels: node => [node.parentElement.querySelector('[role=tabpanel]')] },
    { selector: '.prompt-rules-tabs', panels: node => [node.parentElement.querySelector('.prompt-rules-form')] },
    { selector: '.ui-seg__track', pill: true, panels: (_node, selected) => [document.getElementById(selected.getAttribute('aria-controls'))] },
    { selector: '.market-tabs', panels: node => [...following(node), ...(location.hash.endsWith('/tools') ? [document.querySelector('.configuration-outlet')] : [])] },
    { selector: '.automation-tabs', panels: node => following(node).filter(n => n.tagName === 'SECTION') },
    { selector: '.resource-tabs', panels: node => [node.closest('.resource-workspace').querySelector('.session-panel-content')] },
    { selector: '.browser-tabs', panels: node => [node.closest('.browser-panel').querySelector('.browser-viewport')] },
    { selector: '.operator-workspace .tabs[role=group]', panels: node => [node.parentElement.querySelector('.integration-grid')] }
  ]
  const selectedSelector = '[aria-selected=true],[aria-current=page],[aria-pressed=true]'
  const controlsSelector = '[role=tab],button[aria-current],a[aria-current],.workspace-tab,.market-tabs>a,.automation-tabs>button,.tab[aria-pressed]'
  function play(node, frames, duration) {
    animations.get(node)?.cancel()
    if (!visible(node) || media.matches || document.hidden || !node.animate) return
    const animation = node.animate(frames, { duration, easing })
    animations.set(node, animation)
    const clean = () => { if (animations.get(node) === animation) animations.delete(node) }
    void animation.finished.then(clean, clean)
  }
  function position(node, parent) {
    const rect = node.getBoundingClientRect(), root = parent.getBoundingClientRect()
    return { x: rect.left - root.left + parent.scrollLeft - parent.clientLeft,
      y: rect.top - root.top + parent.scrollTop - parent.clientTop, width: rect.width, height: rect.height }
  }
  function currentPanels(nodes) {
    return nodes.map(node => {
      if (!visible(node) || !animations.has(node)) return null
      const style = getComputedStyle(node)
      return { opacity: style.opacity, transform: style.transform }
    })
  }
  function capture() {
    for (const group of groups.values()) {
      if (visible(group.indicator)) group.from = position(group.indicator, group.node)
      group.inFlight = animations.has(group.indicator)
      group.panelFrames = currentPanels(group.panels)
    }
  }
  function enterPanels(nodes, direction, previous = []) {
    nodes.forEach((node, index) => {
      if (!visible(node)) return
      const ongoing = currentPanels([node])[0]
      play(node, [ongoing || previous[index] || { opacity: .55, transform: `translateX(${direction * 8}px)` },
        { opacity: 1, transform: 'none' }], 180)
    })
  }
  function routeView() {
    const hash = location.hash.slice(1)
    const family = hash.split('/')[0] || 'tasks'
    return location.pathname === '/chat' ? 'chat' : location.pathname + '#' + family + (family === 'plugin' ? '/' + hash.split('/')[1] : '')
  }
  function refresh() {
    frame = 0
    if (disposed) return
    const nextRoute = routeView(), routeChanged = route !== null && route !== nextRoute
    route = nextRoute
    const nextGroups = new Map(), nextObserved = new Set()
    const changedPanels = []
    for (const adapter of adapters) for (const node of document.querySelectorAll(adapter.selector)) {
      if (!visible(node)) continue
      const selected = node.querySelector(selectedSelector)
      if (!selected) continue
      const controls = [...node.querySelectorAll(controlsSelector)]
      const index = controls.indexOf(selected)
      const identity = selected.dataset.motionKey || selected.id || selected.getAttribute('href') || String(index)
      const id = adapter.selector + ':' + (node.id || node.getAttribute('aria-label') || '')
      const old = groups.get(id)
      let indicator = node.querySelector(':scope > .tab-motion-indicator')
      if (!indicator) {
        indicator = document.createElement('span')
        indicator.className = 'tab-motion-indicator' + (adapter.pill ? ' tab-motion-pill' : '')
        indicator.setAttribute('aria-hidden', 'true')
        node.append(indicator)
      }
      node.dataset.tabMotion = 'ready'
      const rect = position(selected, node)
      const target = { ...rect, y: adapter.pill ? rect.y : rect.y + rect.height - 2, height: adapter.pill ? rect.height : 2 }
      const changed = !!old && old.identity !== identity
      const from = old && visible(old.indicator) ? position(old.indicator, old.node) : old?.from
      const panels = adapter.panels(node, selected).filter(visible)
      // Do not re-place a moving indicator on unrelated polling/streaming updates.
      const replaced = !!old && old.node !== node
      const moved = !old || replaced || Object.keys(target).some(k => Math.abs(target[k] - old.target[k]) > .5)
      if (changed || moved) {
        animations.get(indicator)?.cancel()
        Object.assign(indicator.style, { left: target.x + 'px', top: target.y + 'px', width: target.width + 'px', height: target.height + 'px' })
        if ((changed || replaced && old.inFlight) && from && !routeChanged && target.width > 0)
          play(indicator, [{ transform: `translate(${from.x - target.x}px,${from.y - target.y}px) scale(${from.width / target.width},${from.height / target.height})` }, { transform: 'none' }], 220)
      }
      if ((changed || replaced && old.panelFrames?.some(Boolean)) && !routeChanged) changedPanels.push({ panels, direction: index >= old.index ? 1 : -1, previous: old.panelFrames })
      nextGroups.set(id, { node, indicator, identity, index, target, from: target, panels, panelFrames: [] })
      nextObserved.add(node)
    }
    // An outer section switch already animates its content, so nested tabs must not double-fade it.
    const panelNodes = changedPanels.flatMap(change => change.panels)
    for (const change of changedPanels)
      enterPanels(change.panels.filter(node => !panelNodes.some(other => other !== node && other.contains(node))), change.direction, change.previous)
    if (routeChanged) {
      const shell = document.querySelector('.chat-main')
      const content = shell ? [...shell.children].filter(n => !n.matches('header') && visible(n)) : [document.querySelector('.operator-body')].filter(visible)
      for (const node of content) play(node, [{ opacity: .55, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], 200)
    }
    for (const [node, animation] of animations) if (!node.isConnected) { animation.cancel(); animations.delete(node) }
    for (const node of observed) if (!nextObserved.has(node)) { resize?.unobserve(node); observed.delete(node) }
    for (const node of nextObserved) if (!observed.has(node)) { resize?.observe(node); observed.add(node) }
    groups.clear(); nextGroups.forEach((value, id) => groups.set(id, value))
  }
  function schedule() { if (!frame && !disposed) frame = requestAnimationFrame(refresh) }
  function stop() { animations.forEach(animation => animation.cancel()); animations.clear() }
  function preference() { if (media.matches) stop(); schedule() }
  function visibility() { if (document.hidden) stop(); else schedule() }
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
  const observer = new MutationObserver(schedule)
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['aria-selected', 'aria-current', 'aria-pressed', 'hidden', 'data-motion-key'] })
  document.addEventListener('click', capture, true)
  document.addEventListener('keydown', capture, true)
  document.addEventListener('visibilitychange', visibility)
  window.addEventListener('resize', schedule)
  window.addEventListener('hashchange', schedule)
  window.addEventListener('popstate', schedule)
  media.addEventListener('change', preference)
  const destroy = () => {
    disposed = true; cancelAnimationFrame(frame); stop(); observer.disconnect(); resize?.disconnect()
    document.removeEventListener('click', capture, true); document.removeEventListener('keydown', capture, true)
    document.removeEventListener('visibilitychange', visibility); window.removeEventListener('resize', schedule)
    window.removeEventListener('hashchange', schedule); window.removeEventListener('popstate', schedule)
    media.removeEventListener('change', preference)
    for (const group of groups.values()) { group.indicator.remove(); delete group.node.dataset.tabMotion }
    groups.clear(); delete globalThis[key]
  }
  globalThis[key] = { capture, destroy }
  schedule()
})()
