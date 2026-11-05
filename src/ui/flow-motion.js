/* Adapted from the user-owned Tool Access Map integration module. */
const AgentHubMotion=(()=>{
/**
 * Original DOM/SVG motion extracted from the Tool Access Map study.
 * No fixtures, simulation, network requests, application layout, or business state.
 */
const NS = 'http://www.w3.org/2000/svg';
const STATES = new Set(['idle', 'queued', 'running', 'done', 'failed', 'cancelled', 'unknown']);

/** Rounded orthogonal path. Coordinates are in the SVG's local pixel space. */
function roundedConnector(start, end, { axis = 'x', radius = 9 } = {}) {
  const horizontal = axis !== 'y';
  const [a, b] = horizontal ? [start.x, start.y] : [start.y, start.x];
  const [c, d] = horizontal ? [end.x, end.y] : [end.y, end.x];
  if (![a, b, c, d, radius].every(Number.isFinite)) throw new TypeError('Connector coordinates must be finite numbers.');
  const p = (x, y) => horizontal ? `${x} ${y}` : `${y} ${x}`;
  const mid = (a + c) / 2;
  const along = Math.sign(c - a);
  const across = Math.sign(d - b);
  const r = Math.max(0, Math.min(radius, Math.abs(c - a) / 4, Math.abs(d - b) / 2));
  if (r < .5) return `M ${p(a, b)} L ${p(mid, b)} L ${p(mid, d)} L ${p(c, d)}`;
  return `M ${p(a, b)} L ${p(mid - along * r, b)} Q ${p(mid, b)} ${p(mid, b + across * r)} L ${p(mid, d - across * r)} Q ${p(mid, d)} ${p(mid + along * r, d)} L ${p(c, d)}`;
}

/**
 * nodes: Map<stableNodeId, HTMLElement>
 * setEdges receives complete current state, never raw transport events:
 * { id, from, to, state, available?, axis?: 'x'|'y', staggerMs? }
 * The host owns card rendering, focus, subscriptions, ordering and tool replay.
 */
function createFlowMotion({ root, svg, nodes = new Map(), pathForEdge }) {
  if (!root || !svg || !root.contains(svg)) throw new TypeError('root must contain the SVG overlay.');
  const media = root.ownerDocument.defaultView.matchMedia('(prefers-reduced-motion: reduce)');
  const entries = new Map();
  const animations = new Map();
  const layers = ['base', 'path', 'flow'].map(() => {
    const layer = root.ownerDocument.createElementNS(NS, 'g');
    svg.append(layer);
    return layer;
  });
  svg.classList.add('tam-connections');
  svg.setAttribute('aria-hidden', 'true');
  let elements = new Map();
  let frame = 0;
  let destroyed = false;

  function layout() {
    if (destroyed) return;
    const bounds = svg.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
    const rects = new Map();
    for (const [id, element] of elements) rects.set(id, element.getBoundingClientRect());
    for (const entry of entries.values()) {
      const a = rects.get(entry.edge.from);
      const b = rects.get(entry.edge.to);
      const visible = a && b && a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0;
      for (const path of entry.paths) path.style.display = visible ? '' : 'none';
      if (!visible) continue;
      const vertical = entry.edge.axis === 'y';
      const forward = vertical ? b.top + b.height / 2 >= a.top + a.height / 2 : b.left + b.width / 2 >= a.left + a.width / 2;
      const start = vertical
        ? { x: a.left + a.width / 2 - bounds.left, y: (forward ? a.bottom : a.top) - bounds.top }
        : { x: (forward ? a.right : a.left) - bounds.left, y: a.top + a.height / 2 - bounds.top };
      const end = vertical
        ? { x: b.left + b.width / 2 - bounds.left, y: (forward ? b.top : b.bottom) - bounds.top }
        : { x: (forward ? b.left : b.right) - bounds.left, y: b.top + b.height / 2 - bounds.top };
      const d = pathForEdge?.(entry.edge, rects, bounds) ?? roundedConnector(start, end, { axis: vertical ? 'y' : 'x' });
      for (const path of entry.paths) path.setAttribute('d', d);
    }
  }
  function requestLayout() {
    if (frame || destroyed) return;
    frame = requestAnimationFrame(() => { frame = 0; layout(); });
  }
  const observer = new ResizeObserver(requestLayout);
  root.ownerDocument.defaultView.addEventListener('scroll', requestLayout, { passive: true, capture: true });
  function setNodes(nextNodes) {
    if (destroyed) return;
    elements = new Map(nextNodes);
    observer.disconnect();
    observer.observe(root);
    for (const element of elements.values()) observer.observe(element);
    requestLayout();
  }
  function setEdges(edges, { redraw = false } = {}) {
    if (destroyed) return;
    // Validate before mutation so malformed snapshots cannot half-update the graph.
    const ids = new Set();
    for (const edge of edges) {
      if (!edge.id || ids.has(edge.id) || !edge.from || !edge.to || !STATES.has(edge.state)) throw new TypeError('Edges need unique IDs, endpoints and a supported state.');
      ids.add(edge.id);
    }
    for (const [id, entry] of entries) if (!ids.has(id)) {
      entry.paths.forEach((path) => path.remove());
      entries.delete(id);
    }
    const redrawPaths = [];
    edges.forEach((edge, index) => {
      let entry = entries.get(edge.id);
      if (!entry) {
        const paths = layers.map((layer, i) => {
          const path = root.ownerDocument.createElementNS(NS, 'path');
          path.classList.add(['tam-base', 'tam-path', 'tam-flow'][i]);
          if (i > 0) path.setAttribute('pathLength', '1');
          layer.append(path);
          return path;
        });
        entry = { edge: { ...edge }, paths };
        entries.set(edge.id, entry);
      }
      const becameAvailable = entry.edge.available === false && edge.available !== false;
      entry.edge = { ...edge };
      for (const path of entry.paths) {
        path.dataset.state = edge.state;
        path.dataset.edgeId = edge.id;
        path.dataset.available = String(edge.available !== false);
        const delay = Number.isFinite(edge.staggerMs) ? Math.max(0, edge.staggerMs) : Math.min(index, 4) * 30;
        path.style.setProperty('--tam-delay', `${delay}ms`);
      }
      const path = entry.paths[1];
      if (redraw || becameAvailable || !path.classList.contains('tam-draw')) redrawPaths.push(path);
    });
    // Repeated streaming updates preserve running flow and don't replay entry motion.
    if (redrawPaths.length) {
      redrawPaths.forEach((path) => path.classList.remove('tam-draw'));
      void svg.getBoundingClientRect();
      redrawPaths.forEach((path) => path.classList.add('tam-draw'));
    }
    requestLayout();
  }
  function animate(element, keyframes, duration) {
    if (destroyed) return null;
    animations.get(element)?.cancel();
    animations.delete(element);
    if (media.matches) return null;
    const result = element.animate(keyframes, { duration, easing: 'cubic-bezier(.22,1,.36,1)' });
    // Cancelling on render or route change must not emit an unhandled rejection.
    void result.finished.catch(() => {});
    animations.set(element, result);
    const clean = () => { if (animations.get(element) === result) animations.delete(element); };
    result.addEventListener('finish', clean, { once: true });
    result.addEventListener('cancel', clean, { once: true });
    return result;
  }
  function reveal(element) {
    return animate(element, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], 350);
  }
  function details(element, { enter = true } = {}) {
    const previous = animations.get(element);
    const style = previous ? root.ownerDocument.defaultView.getComputedStyle(element) : null;
    const start = style
      ? { opacity: style.opacity, transform: style.transform }
      : enter ? { opacity: 0, transform: 'translateY(16px) scale(.985)' } : { opacity: 1, transform: 'none' };
    return animate(element, [start, enter
      ? { opacity: 1, transform: 'none' }
      : { opacity: 0, transform: 'translateY(8px) scale(.99)' }], enter ? 320 : 180);
  }
  const motionChange = () => {
    if (media.matches) { animations.forEach((animation) => animation.cancel()); animations.clear(); }
  };
  media.addEventListener('change', motionChange);
  setNodes(nodes);
  return {
    setNodes, setEdges, layout: requestLayout, reveal, details,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      root.ownerDocument.defaultView.removeEventListener('scroll', requestLayout, { capture: true });
      media.removeEventListener('change', motionChange);
      animations.forEach((animation) => animation.cancel());
      animations.clear();
      layers.forEach((layer) => layer.remove());
      entries.clear();
      elements.clear();
    },
  };
}

return {createFlowMotion,roundedConnector};
})();
