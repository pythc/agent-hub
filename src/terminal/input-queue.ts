import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Snapshot } from './client.ts'

export type InputMode = 'queue' | 'steer'
export interface QueuedInput { id: string; text: string; files: string[]; contextVersion: number; attachments?: string[]; error?: string }
export function routerProcessing(view?: Snapshot) {
  return !!view && (!!view.reply || !!view.run && ['running','queued','cancel_requested'].includes(view.run.state))
}

/** Unsent drafts stay local; a restored queue always requires an explicit resume. */
export class InputQueue {
  items: QueuedInput[] = []
  paused = false
  sending?: string
  private held = new Set<string>()
  constructor(private path: string, private changed: () => void,
    private send: (item: QueuedInput, mode: InputMode) => Promise<void>) {
    if (existsSync(path)) { this.items = JSON.parse(readFileSync(path,'utf8')); this.paused = this.items.length > 0 }
  }
  private save() {
    mkdirSync(dirname(this.path),{recursive:true,mode:0o700})
    const temp=this.path+'.tmp'
    writeFileSync(temp,JSON.stringify(this.items),{mode:0o600});renameSync(temp,this.path)
    this.changed()
  }
  add(text:string,files:string[],contextVersion:number) {
    this.items.push({id:randomUUID(),text,files,contextVersion});this.save()
  }
  hold(id:string) { this.held.add(id) }
  release(id:string) { this.held.delete(id) }
  edit(id:string,text:string) {
    const item=this.items.find(item=>item.id===id)
    if(!item||this.sending===id)return
    if(item.attachments)throw Error('Delivery is uncertain. Retry this item before editing it.')
    item.text=text;delete item.error;this.save()
  }
  remove(id:string) { if(this.sending===id)return;this.items=this.items.filter(item=>item.id!==id);this.held.delete(id);this.save() }
  move(id:string,offset:number) {
    const from=this.items.findIndex(item=>item.id===id),to=from+offset
    if(from<0||to<0||to>=this.items.length||this.sending===id||this.sending===this.items[to]?.id)return
    const [item]=this.items.splice(from,1);this.items.splice(to,0,item!);this.save()
  }
  uploaded(id:string,attachments:string[]) { const item=this.items.find(item=>item.id===id);if(item){item.attachments=attachments;this.save()} }
  toggle() { this.paused=!this.paused;this.changed() }
  async deliver(id:string,mode:InputMode) {
    const item=this.items.find(item=>item.id===id)
    if(!item)return
    if(this.sending)throw Error('Wait for the current queued message to finish sending.')
    this.sending=id;this.changed()
    try { await this.send(item,mode);this.items=this.items.filter(entry=>entry.id!==id);this.held.delete(id) }
    catch(error) { item.error=(error as Error).message;this.paused=true;throw error }
    finally {this.sending=undefined;this.save()}
  }
  async drain(view:Snapshot) {
    const first=this.items[0]
    if(!first||this.paused||this.sending||this.held.has(first.id)||routerProcessing(view))return
    if(first.contextVersion!==view.conversation.contextVersion){this.paused=true;first.error='Conversation was cleared. Review this draft before sending.';this.save();return}
    await this.deliver(first.id,'queue')
  }
}
