import type {MemoryProjection} from '../../src/router-memory.ts';

type Labels = (en: string, zh: string) => string;
export type MemoryDetail = {key: string; value: string};

/** Compact display of authorized metadata; never grants authority or claims truth. */
export function memoryProvenance(fact: MemoryProjection, L: Labels): MemoryDetail[] {
  const origins: Record<string, string> = {
    explicit: L('Explicitly requested', '明确要求记住'),
    manual: L('Saved by hand', '手动保存'),
    extracted: L('From conversation', '来自会话'),
    consolidated: L('Combined memories', '整理自已有记忆'),
    experience: L('Recorded experience', '经验记录'),
  };
  const origin = fact.learning?.inferred ? L('Inferred memory', '推断记忆') : origins[fact.origin ?? ''];
  const details: MemoryDetail[] = origin ? [{key:'origin',value:origin}] : [];
  if (fact.expiresAt !== undefined) {
    const instant = new Date(fact.expiresAt);
    const date = Number.isFinite(fact.expiresAt) && !Number.isNaN(instant.getTime())
      ? instant.toISOString().replace('T',' ').replace(/\.000Z$/,'Z').replace('Z',' UTC') : null;
    details.push({key:'expiry',value:date ? L('Expires '+date,'有效期至 '+date) : L('Expiry unavailable','有效期未知')});
  }
  return details;
}

/** Classification is descriptive metadata, not a task decision or an action grant. */
export function memoryCategory(fact: MemoryProjection): 'preference'|'fact'|'project_decision'|'method' {
  if (['preference','fact','project_decision','method'].includes(fact.category ?? '')) return fact.category!;
  return fact.kind === 'preference' ? 'preference' : fact.origin === 'experience' ? 'method' : 'fact';
}
export function memoryCategoryLabel(category:ReturnType<typeof memoryCategory>,L:Labels):string {
  return {preference:L('Preferences','偏好'),fact:L('Facts','事实'),project_decision:L('Project decisions','项目决定'),method:L('Methods','方法')}[category];
}
function timestamp(value: number):string|null {
  const date=new Date(value);
  return Number.isFinite(value)&&!Number.isNaN(date.getTime())?date.toISOString().replace('T',' ').replace(/\.000Z$/,'Z').replace('Z',' UTC'):null;
}
export function memoryDetails(fact:MemoryProjection,L:Labels):MemoryDetail[] {
  const saved=timestamp(fact.createdAt);
  const scope={private:L('Only you','仅自己'),group:L('This conversation scope','当前会话范围'),task:L('This task only','仅此任务')}[fact.visibility];
  const rows=[{key:'saved',value:saved?L('Saved '+saved,'保存于 '+saved):L('Save time unavailable','保存时间未知')},{key:'scope',value:scope??L('Scope unavailable','范围未知')}];
  if(fact.taskRecord){
    const state={open:L('Open','未结束'),completed:L('Completed','已完成'),merged:L('Merged','已合并'),closed:L('Closed','已关闭'),dropped:L('Dropped','已放弃'),stopped:L('Stopped','已停止')}[fact.taskRecord.state];
    rows.push({key:'task',value:L('Current task record: ','当前任务记录：')+state});
    if(fact.taskRecord.newerThanMemory)rows.push({key:'task-newer',value:L('Task updated after this memory. Check whether the memory needs correcting.','任务记录晚于这条记忆，请核对是否需要修改记忆。')});
  }
  return rows;
}
