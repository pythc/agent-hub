import type {UsagePurpose,UsageSummary} from '../../src/usage-contract.ts'

export function TeamUsage({usage,language}:{usage?:UsageSummary;language:'en'|'zh-CN'}){
 const L=(en:string,zh:string)=>language==='zh-CN'?zh:en
 const n=(value:number|null|undefined)=>value==null?L('Unknown','未知'):value.toLocaleString(language)
 const labels:Record<UsagePurpose,string>={router:'Router',worker:'Worker',subagent:L('Subagents','子代理'),verification:L('Acceptance','独立验收'),replanning:L('Replanning','重规划'),plan_review:L('Plan review','方案复核'),memory:L('Memory','记忆处理'),auxiliary:L('Auxiliary','辅助判断'),watchdog:L('Watchdog','监督巡检')}
 return <section className="records team-usage" aria-label={L('Team token usage','团队 token 用量')}>
  <header className="plain-head"><h2>{L('Team token usage','团队 token 用量')}</h2><span className="muted">{L('Reported usage','已报告用量')}</span></header>
  {!usage?<p>{L('This host does not provide team usage yet.','当前宿主尚未提供团队用量。')}</p>:<>
   <dl className="usage-totals">{[
    [L('Total tokens','合计 token'),usage.tokens.totalTokens,L('Input plus output; excludes unknown usage. Not a bill.','输入加输出，未包含未知用量；不是账单。')],
    [L('Input','输入'),usage.tokens.inputTokens,''],[L('Cached input','缓存输入'),usage.tokens.cachedInputTokens,L('Already included in input; do not add again.','已包含在输入中，不重复相加。')],
    [L('Output','输出'),usage.tokens.outputTokens,''],[L('Reasoning output','推理输出'),usage.tokens.reasoningOutputTokens,L('Already included in output; missing counts are unknown.','已包含在输出中；未返回时为未知。')],
   ].map(([label,value,note])=><div key={String(label)} title={String(note)}><dt>{label}</dt><dd className="mono">{n(value as number|null)}</dd></div>)}</dl>
   <p className="usage-coverage" role="status">{L('Calls with usage','有用量的调用')} {usage.reportedCalls} / {usage.calls} · {L('Unknown','未知')} {usage.unknownCalls} · <span title={L('Includes failed/interrupted attempts and incomplete input/output reporting. Known usage is still counted.','包含失败、中断或输入输出缺报；已经返回的用量仍计入。')}>{L('Partial','部分用量')} {usage.partialCalls}</span></p>
   {usage.watchdogUnavailable&&<p role="status">{L('Watchdog usage is unavailable; shown totals may be incomplete.','监督巡检用量暂不可读；当前合计可能不完整。')}</p>}
   <div className="usage-table-wrap"><table><thead><tr><th>{L('Purpose','用途')}</th><th>{L('Input','输入')}</th><th>{L('Cached','缓存')}</th><th>{L('Output','输出')}</th><th>{L('Reported calls','有用量 / 调用')}</th></tr></thead><tbody>{usage.groups.map(group=><tr key={group.purpose}><td>{labels[group.purpose]}</td><td>{n(group.tokens.inputTokens)}</td><td>{n(group.tokens.cachedInputTokens)}</td><td>{n(group.tokens.outputTokens)}</td><td>{group.reportedCalls} / {group.calls}</td></tr>)}</tbody></table></div>
   <p className="usage-period">{usage.since?L('Recorded since ','统计始于 ')+new Date(usage.since).toLocaleString(language):L('No calls recorded yet.','尚无调用记录。')}{usage.legacyUntrackedCalls?L(` · ${usage.legacyUntrackedCalls} retained older calls have no accounting record.`,` · 最近保留的 ${usage.legacyUntrackedCalls} 次旧调用没有统计记录。`):''}</p>
  </>}
 </section>
}
