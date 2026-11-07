export type ResourceKind = 'new' | 'files' | 'browser' | 'activity';
export type ToolKind = Exclude<ResourceKind, 'new'>;
export type ResourceTab = { id: string; kind: ResourceKind };
export type ResourceState = {
  tabs: ResourceTab[];
  active: string;
  visible: boolean;
  recent: { kind: ToolKind; at: number }[];
};
const kinds: ResourceKind[] = ['new', 'files', 'browser', 'activity'];
const tab = (kind: ResourceKind): ResourceTab => ({ id: crypto.randomUUID(), kind });
export const resourceKey = (conversationId: string | null) => 'roppo.resources.' + (conversationId ?? 'new');
export function initialResources(raw: string, legacy = ''): ResourceState {
  try {
    const value = JSON.parse(raw);
    if (!value || !Array.isArray(value.tabs) || value.tabs.length < 1 || value.tabs.length > 12) throw Error();
    const ids = new Set<string>(), tools = new Set<string>();
    const tabs = value.tabs.map((t: ResourceTab) => {
      if (!t || typeof t.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(t.id) || ids.has(t.id) || !kinds.includes(t.kind) || (t.kind !== 'new' && tools.has(t.kind))) throw Error();
      ids.add(t.id); tools.add(t.kind);
      return { id: t.id, kind: t.kind };
    });
    return { tabs, active: ids.has(value.active) ? value.active : tabs[0]!.id, visible: value.visible === true,
      recent: Array.isArray(value.recent) ? value.recent.filter((r: {kind:ToolKind;at:number}) => r && ['files','browser','activity'].includes(r.kind) && Number.isFinite(r.at) && r.at >= 0 && r.at <= 8.64e15).slice(0,3) : [] };
  } catch {
    const first = tab(kinds.includes(legacy as ResourceKind) ? legacy as ResourceKind : 'new');
    return { tabs: [first], active: first.id, visible: first.kind !== 'new', recent: [] };
  }
}
export function openResource(state: ResourceState, kind: ResourceKind, at = Date.now()): ResourceState {
  const existing = state.tabs.find(t => t.kind === kind);
  const next = existing ?? tab(kind);
  // One launcher and one view of each tool; reopening restores its existing tab.
  return { tabs: existing ? state.tabs : [...state.tabs, next], active: next.id, visible: true,
    recent: kind === 'new' ? state.recent : [{kind,at}, ...state.recent.filter(r => r.kind !== kind)].slice(0,3) };
}
export function closeResource(state: ResourceState, id: string): ResourceState {
  const index = state.tabs.findIndex(t => t.id === id);
  if (index < 0) return state;
  const tabs = state.tabs.filter(t => t.id !== id);
  if (!tabs.length) { const first = tab('new'); return {...state, tabs:[first],active:first.id}; }
  return {...state,tabs,active:state.active === id ? tabs[Math.min(index,tabs.length-1)]!.id : state.active};
}
/** New-tab input accepts web URLs only; a non-URL remains a tool search. */
export function resourceUrl(value: string): string | null {
  const text = value.trim();
  if (!text || /\s/.test(text)) return null;
  if (!/^https?:\/\//i.test(text) && !/^(localhost|127\.0\.0\.1|\[[\da-f:]+\]|[\w-]+(?:\.[\w-]+)+)(?::\d+)?(?:[/?#]|$)/i.test(text)) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : (/^(localhost|127\.0\.0\.1)([:/]|$)/i.test(text) ? 'http://' : 'https://') + text);
    return ['http:','https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
