// A clearly labeled, user-controlled explanation. It never reads or synthesizes runtime call state.
let workflowStoryCleanup = null
function workflowStoryUnmount() { workflowStoryCleanup?.(); workflowStoryCleanup = null }
function workflowStory() {
  const steps = [
    [L('Set the goal', '提出目标'), L('Tell Router what you need in your connected conversation. Router keeps the goal and context.', '在已接入的会话中交代目标。Router 保留目标和上下文，作为你的统一对话入口。')],
    [L('Delegate work', '分派任务'), L('Router defines the scope and assigns work to Workers. Each Worker uses its own configured model and tools.', 'Router 明确范围并分派任务。每个 Worker 使用各自配置的模型与工具执行。')],
    [L('Report back', '回报进展'), L('Workers return progress, questions and results to Router. Follow-up instructions remain attached to the task.', 'Worker 向 Router 回报进展、问题与结果。补充要求仍关联同一任务，工作可以持续推进。')],
    [L('Return the result', '汇总结果'), L('Router brings the result or a request for your decision back to the original conversation.', 'Router 汇总结果，或将需要你决策的问题带回原会话。你始终与 Router 对话。')]
  ]
  const section = el('section', 'team-explanation workflow-story')
  section.setAttribute('aria-labelledby', 'workflow-story-title')
  const title = el('h2', '', L('How work moves', '任务如何流转')); title.id = 'workflow-story-title'
  const close = opButton(L('Close explanation', '收起说明'), () => {
    teamStudio.explain = false; render(); document.getElementById('team-story-toggle')?.focus({ preventScroll: true })
  }, 'text-button')
  section.append(add(el('div', 'section-heading'), title, close),
    el('p', 'team-help story-disclaimer', L('Interactive explanation · no task or model request is executed.', '交互示意 · 不执行任务，也不调用模型。')))
  const scene = el('div', 'story-scene')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('story-wires'); svg.setAttribute('aria-hidden', 'true')
  scene.append(svg)
  const node = (key, name, role, glyph) => {
    const item = add(el('div', 'story-node'), add(el('span', 'story-icon'), icon(glyph)), add(el('div'), el('strong', '', name), el('small', '', role)))
    item.dataset.storyNode = key; return item
  }
  scene.append(node('you', L('You & your team', '你与团队'), L('Connected conversation', '已接入的会话'), 'conversations'),
    node('router', 'Router', L('Coordinates and responds', '统筹任务 · 统一回复'), 'execution'))
  const workers = teamWorkers(), pool = el('div', 'story-workers')
  pool.append(el('span', 'story-pool-label', 'Workers · ' + workers.length))
  workers.slice(0, 3).forEach((worker, index) => pool.append(node('worker:' + worker.id, worker.label || 'Worker ' + (index + 1), L('Executes and reports', '执行 · 回报'), 'cpu')))
  if (workers.length > 3) pool.append(el('small', 'team-help', L('Showing 3 of ' + workers.length + ' Workers', '展示 ' + workers.length + ' 位执行者中的 3 位')))
  scene.append(pool)
  const track = el('div', 'team-steps'); track.setAttribute('aria-label', L('Workflow steps', '流程步骤'))
  const description = el('p', 'team-step-description'); description.id = 'workflow-story-description'; description.setAttribute('aria-live', 'polite')
  const play = opButton('', null, 'button primary'); play.id = 'workflow-story-play'
  const replay = opButton(L('Replay this step', '重播此步'), null, 'button', 'refresh'); replay.id = 'workflow-story-replay'
  const progress = el('span', 'story-position')
  steps.forEach(([label], index) => {
    const button = opButton(label, null, 'team-step'); button.id = 'workflow-story-step-' + index
    button.setAttribute('aria-controls', description.id); track.append(button)
  })
  section.append(scene, track, description, add(el('div', 'story-controls'), play, replay, progress))
  queueMicrotask(() => {
    if (!section.isConnected) return
    workflowStoryUnmount()
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const nodes = new Map([...scene.querySelectorAll('[data-story-node]')].map(item => [item.dataset.storyNode, item]))
    let timer = 0, frame = 0, playing = false, destroyed = false
    const animations = new Set()
    const edges = [{ from: 'you', to: 'router' }, ...workers.slice(0, 3).map(worker => ({ from: 'router', to: 'worker:' + worker.id }))]
    for (const edge of edges) {
      edge.path = document.createElementNS(svg.namespaceURI, 'path'); edge.signal = document.createElementNS(svg.namespaceURI, 'path')
      edge.path.setAttribute('class', 'story-path'); edge.signal.setAttribute('class', 'story-signal')
      edge.signal.setAttribute('pathLength', '1'); svg.append(edge.path, edge.signal)
    }
    function layout() {
      frame = 0
      if (destroyed || !scene.isConnected) return
      const bounds = scene.getBoundingClientRect()
      svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`)
      for (const edge of edges) {
        const a = nodes.get(edge.from).getBoundingClientRect(), b = nodes.get(edge.to).getBoundingClientRect()
        const vertical = b.left < a.right && b.top >= a.bottom
        const start = vertical ? { x: (a.left + a.right) / 2 - bounds.left, y: a.bottom - bounds.top } : { x: a.right - bounds.left, y: (a.top + a.bottom) / 2 - bounds.top }
        const end = vertical ? { x: (b.left + b.right) / 2 - bounds.left, y: b.top - bounds.top } : { x: b.left - bounds.left, y: (b.top + b.bottom) / 2 - bounds.top }
        const reverse = teamStudio.step >= 2
        const path = AgentHubMotion.roundedConnector(reverse ? end : start, reverse ? start : end, { axis: vertical ? 'y' : 'x', radius: 10 })
        edge.path.setAttribute('d', path); edge.signal.setAttribute('d', path)
      }
    }
    function cancelSignals() { animations.forEach(animation => animation.cancel()); animations.clear() }
    function updateControls() {
      play.textContent = playing ? L('Pause explanation', '暂停示意') : L('Play explanation', '播放示意')
      play.setAttribute('aria-pressed', String(playing)); play.disabled = media.matches
      replay.disabled = media.matches
      play.title = media.matches ? L('Reduced motion is on. Select a step to view it.', '已开启减少动态效果，可直接选择步骤查看。') : ''
      progress.textContent = (teamStudio.step + 1) + ' / ' + steps.length
      section.dataset.playing = String(playing)
    }
    function stop() { clearTimeout(timer); timer = 0; playing = false; cancelSignals(); updateControls() }
    function select(index, pulse = true) {
      teamStudio.step = index; cancelSignals()
      const delegation = index === 1 || index === 2
      track.querySelectorAll('button').forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)))
      description.textContent = steps[index][1]
      for (const [key, item] of nodes) item.dataset.storyActive = String(key === 'router' || (delegation ? key !== 'you' : key === 'you'))
      layout(); updateControls()
      for (const edge of edges) {
        const selected = delegation ? edge.from === 'router' : edge.from === 'you'
        edge.path.dataset.active = String(selected)
        if (!selected || !pulse || media.matches || document.hidden) continue
        const animation = edge.signal.animate([{ strokeDashoffset: 1, opacity: 1 }, { strokeDashoffset: -.08, opacity: 1 }], { duration: 1200, easing: 'linear' })
        animations.add(animation); void animation.finished.then(() => animations.delete(animation), () => animations.delete(animation))
      }
    }
    function advance(index) {
      if (!playing || destroyed) return
      select(index)
      timer = setTimeout(() => { if (index < steps.length - 1) advance(index + 1); else stop() }, 1600)
    }
    play.onclick = () => { if (playing) stop(); else { playing = true; advance(0) } }
    replay.onclick = () => { stop(); select(teamStudio.step) }
    track.querySelectorAll('button').forEach((button, index) => { button.onclick = () => { stop(); select(index) } })
    const observer = new ResizeObserver(() => { if (!frame) frame = requestAnimationFrame(layout) }); observer.observe(scene)
    const visibility = () => { if (document.hidden) stop() }
    const preference = () => { stop(); select(teamStudio.step, false) }
    document.addEventListener('visibilitychange', visibility); media.addEventListener('change', preference)
    select(teamStudio.step, false)
    workflowStoryCleanup = () => {
      destroyed = true; clearTimeout(timer); cancelAnimationFrame(frame); cancelSignals(); observer.disconnect()
      document.removeEventListener('visibilitychange', visibility); media.removeEventListener('change', preference)
    }
  })
  return section
}
