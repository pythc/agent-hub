type Language='en'|'zh-CN'
interface Label {label:string;description:string}
type Copy=Record<string,readonly [string,string,string,string]>

function localized(copy:Copy,value:string,language:Language,fallback:readonly [string,string]):Label{
  const item=Object.hasOwn(copy,value)?copy[value]:undefined
  if(!item)return {label:language==='en'?fallback[0]:fallback[1],description:value}
  return language==='en'?{label:item[0],description:item[2]}:{label:item[1],description:item[3]}
}

export function decisionModeLabel(mode:string,language:Language){
  return localized({
    off:['Off','未开启','The auxiliary model is off. Earlier records may still be shown.','不调用辅助模型，仍可查看之前的记录。'],
    shadow:['Record only','仅记录','The auxiliary model runs and records its judgments without advising Router.','仍会调用辅助模型，只记录判断结果，不影响 Router 的处理。'],
    advisory:['Advise Router','提供建议','The auxiliary model advises Router. Router decides what to do.','辅助模型提供判断建议，是否执行仍由 Router 决定。'],
  },mode,language,['Unknown mode','未知方式'])
}

export function decisionStatusLabel(status:string,language:Language){
  return localized({
    ok:['Judgment received','已返回判断','A valid judgment was received. This does not mean a task was executed.','已获得有效判断，不代表任务已经执行。'],
    unavailable:['No valid result','未获得有效结果','This attempt did not produce a usable judgment.','本次未获得可用的判断结果。'],
    stale:['No longer valid','本次判断已失效','The context changed or this attempt was cancelled. Its judgment is not used.','上下文已变化或本次判断已取消，结果不再用于建议。'],
    skipped:['Skipped','本次已跳过','This attempt was skipped, for example when the concurrency limit was reached.','本次未进行判断，例如已达到同时运行的数量限制。'],
  },status,language,['Unknown status','未知状态'])
}

export function decisionActionLabel(action:string,language:Language){
  return localized({
    STOP:['Suggest stopping','建议停止','The model detected a request to stop existing work. This is a judgment, not proof that work stopped.','模型判断消息要求停止已有任务，并不代表任务已经停止。'],
    CONTINUE:['Suggest following up','建议跟进','The model detected a follow-up to existing work, such as added information or a correction.','模型判断消息在跟进已有任务，可能是补充信息、纠正或要求继续。'],
    IGNORE:['Suggest no action','建议不处理','The model judged that this message needs no agent work.','模型判断这条消息不需要 Agent 处理。'],
    INTERVENE:['Suggest stepping in','建议介入','Router should assess this potential request under its rules. This is not permission to execute it.','建议 Router 按规则判断是否接手，不代表已获得执行授权。'],
    REVIEW:['Needs further review','需要进一步判断','Router needs to inspect the original context before deciding.','需要 Router 查看原始上下文后再决定。'],
  },action,language,['Unknown suggestion','未知建议'])
}
