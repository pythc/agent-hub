// Original WAAPI transitions. Presentation only: never writes configuration or creates task state.
const WorkspaceMotion = (() => {
  const media = matchMedia('(prefers-reduced-motion: reduce)')
  const active = new Map()
  const ease = 'cubic-bezier(.22,1,.36,1)'
  let previous = null
  function animate(node, frames, duration = 220) {
    if (!node?.isConnected || media.matches || document.hidden || !node.animate) return null
    active.get(node)?.cancel()
    const animation = node.animate(frames, { duration, easing: ease })
    active.set(node, animation)
    const clean = () => { if (active.get(node) === animation) active.delete(node) }
    void animation.finished.then(clean, clean)
    return animation
  }
  function enter(node, x = 0, y = 6, duration = 220) {
    return animate(node, [{ opacity: .45, transform: `translate(${x}px,${y}px)` }, { opacity: 1, transform: 'none' }], duration)
  }
  function capture() {
    const inFlight = selector => {
      const node = document.querySelector(selector)
      if (!node || !active.has(node)) return null
      const style = getComputedStyle(node)
      return { opacity: style.opacity, transform: style.transform }
    }
    const inspector = inFlight('#team-inspector'), panel = inFlight('#team-tab-panel')
    const nodes = new Map([...document.querySelectorAll('[data-team-id]')].map(node => {
      const rect = node.getBoundingClientRect()
      return [node.dataset.teamId, { x: rect.left + scrollX, y: rect.top + scrollY }]
    }))
    active.forEach(animation => animation.cancel()); active.clear()
    return { previous, nodes, inspector, panel }
  }
  function settle(snapshot) {
    const next = {
      route: JSON.stringify([S.surface, entryState.role, entryState.page, entryState.selected, workspaceContext.activeId,
        entryState.page === 'execution' ? executionView.mode : '', entryState.page === 'advanced' ? S.advancedKey : '']),
      member: teamStudio.selected, tab: teamStudio.tab, explain: teamStudio.explain
    }
    previous = next
    const old = snapshot.previous
    if (!old || media.matches || document.hidden) return
    if (old.route !== next.route) {
      enter(document.querySelector('.operator-body'), 0, 7, 200)
      return
    }
    if (!document.querySelector('.team-studio')) return
    if (old.member !== next.member) animate(document.getElementById('team-inspector'),
      [snapshot.inspector || { opacity: .45, transform: 'translateX(8px)' }, { opacity: 1, transform: 'none' }], 220)
    else if (old.tab !== next.tab) animate(document.getElementById('team-tab-panel'),
      [snapshot.panel || { opacity: .45, transform: 'translateY(5px)' }, { opacity: 1, transform: 'none' }], 180)
    if (!old.explain && next.explain) enter(document.querySelector('.team-explanation'), 0, -6, 240)
    for (const node of document.querySelectorAll('[data-team-id]')) {
      const from = snapshot.nodes.get(node.dataset.teamId), rect = node.getBoundingClientRect()
      if (!from) { enter(node, 0, 10, 280); continue }
      const x = from.x - rect.left - scrollX, y = from.y - rect.top - scrollY
      if (Math.abs(x) + Math.abs(y) > 1 && old.explain === next.explain)
        animate(node, [{ transform: `translate(${x}px,${y}px)` }, { transform: 'none' }], 280)
    }
  }
  function openDialog(dialog) {
    dialog.classList.add('motion-dialog')
    const trigger = document.activeElement
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(dialog) })
    dialog.addEventListener('close', () => {
      active.get(dialog)?.cancel()
      if (trigger?.isConnected && !document.querySelector('dialog[open]')) trigger.focus({ preventScroll: true })
    }, { once: true })
    dialog.showModal()
    enter(dialog, 18, 0, 240)
  }
  function closeDialog(dialog, action) {
    if (!dialog?.open || dialog.dataset.motionClosing === 'true') return
    dialog.dataset.motionClosing = 'true'
    const style = getComputedStyle(dialog)
    const done = () => {
      if (!dialog.isConnected) return
      dialog.close(); delete dialog.dataset.motionClosing
      action?.()
    }
    const animation = animate(dialog, [{ opacity: style.opacity, transform: style.transform }, { opacity: 0, transform: 'translateX(10px)' }], 130)
    if (animation) void animation.finished.then(done, () => { if (!dialog.isConnected) return; delete dialog.dataset.motionClosing })
    else done()
  }
  function finish() { active.forEach(animation => animation.finish()) }
  media.addEventListener('change', () => { if (media.matches) finish() })
  document.addEventListener('visibilitychange', () => {
    document.documentElement.dataset.motionPaused = String(document.hidden)
    if (document.hidden) finish()
  })
  document.documentElement.dataset.motionPaused = String(document.hidden)
  return { animate, enter, capture, settle, openDialog, closeDialog }
})()
