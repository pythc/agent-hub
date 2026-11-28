import { withTerminalRenderer } from './renderer-session.ts'
import { resolve, join } from 'node:path'
import { InputQueue, routerProcessing, type InputMode } from './input-queue.ts'
import { terminalProfileDirectory } from './profile.ts'
import { saveTerminalSetting } from './settings.ts'
import { spawn } from 'node:child_process'
import { TuiScreen } from './tui-screen.ts'
import { TuiCommands } from './tui-actions.ts'
import { TerminalClient, type Conversation, type Snapshot } from './client.ts'
import { mentionedFiles } from './commands.ts'
import type { HostSettings } from './host-settings.ts'
import type { TerminalSettings } from './settings.ts'

export async function interactiveTui(client: TerminalClient, conversation: Conversation, options: {
  cwd: string; preferences: TerminalSettings; settingsSources: string[]; prompt: string; files: string[]
}): Promise<Conversation | undefined> {
  return withTerminalRenderer(async renderer => {
    const abort = new AbortController()
    let view: Snapshot, next: Conversation | undefined, stopped = false, loadingOlder = false
    let watch: Promise<void> | undefined
    let directSending=false, awaitingRun:string|undefined, pumping=false
    let queue:InputQueue
    const pump=async()=>{
      if(stopped||pumping||directSending||awaitingRun||!view)return
      pumping=true
      try {
        while(!stopped&&!directSending&&!awaitingRun&&!queue.paused&&!routerProcessing(view)&&queue.items.length){
          const before=queue.items[0]!.id
          await queue.drain(view)
          if(queue.items[0]?.id===before)break
          await refresh()
        }
      }finally{pumping=false}
    }
    let finish!: () => void
    const done = new Promise<void>(resolve => { finish = resolve })
    const quit = (conversation?: Conversation) => { next = conversation; stopped = true; abort.abort(); finish() }
    let refreshTail:Promise<void>=Promise.resolve()
    const refresh = () => {
      const next=refreshTail.then(readView);refreshTail=next.catch(()=>{});return next
    }
    const readView = async () => {
      const [current, settings] = await Promise.all([
        client.view(conversation.id, undefined, abort.signal), client.request<HostSettings>('/api/terminal/settings', undefined, { signal: abort.signal })
      ])
      if (stopped || view && current.conversation.contextVersion < view.conversation.contextVersion) return
      if (view && view.conversation.contextVersion === current.conversation.contextVersion) {
        const recent = new Set(current.messages.map(m => m.id))
        const earlier = view.messages.filter(m => !recent.has(m.id) && m.sequence < (current.messages[0]?.sequence ?? Infinity))
        current.messages = [...earlier, ...current.messages]
        if (earlier.length) current.hasMore = view.hasMore
      }
      view = current; screen.update(view); screen.settings(settings); screen.connection(true)
      if(awaitingRun&&(view.run?.id===awaitingRun||view.messages.some(message=>message.runId===awaitingRun)))awaitingRun=undefined
      if(queue)screen.run(pump())
    }
    const older = async () => {
      if (loadingOlder || !view?.hasMore || !view.messages.length) return
      loadingOlder = true
      try {
        const page = await client.older(conversation.id, view.messages[0]!.sequence, abort.signal)
        if (stopped || page.conversation.contextVersion !== view.conversation.contextVersion) return
        const known = new Set(view.messages.map(m => m.id))
        view = { ...view, messages: [...page.messages.filter(m => !known.has(m.id)), ...view.messages], hasMore: page.hasMore }
        screen.update(view, true)
      } finally { loadingOlder = false }
    }
    const send = async (text: string, files: string[] = [],mode:InputMode='queue') => {
      const paths=[...new Set([...files,...mentionedFiles(text,options.cwd)])]
      if(mode==='queue'&&(routerProcessing(view)||queue.items.length||directSending||awaitingRun)){
        queue.add(text,paths,view.conversation.contextVersion);screen.run(pump());return
      }
      directSending=true
      screen.setLoading(true)
      try {
        const result=await client.send(conversation.id,text,paths,Intl.DateTimeFormat().resolvedOptions().locale,{steer:mode==='steer'})
        awaitingRun=result.runId
        if(result.delivery==='next-turn'&&routerProcessing(view))screen.notice('Sent. Router will read this at its next available turn.')
        screen.run(refresh().then(() => { if (!stopped) screen.latest() }))
      }
      finally { directSending=false;if (!stopped) screen.setLoading(false) }
    }
    const interrupt = async () => {
      if(!queue.paused)queue.toggle()
      const run = view?.run
      if (run && ['running', 'queued', 'waiting'].includes(run.state)) {
        await client.request('/api/chat/conversations/' + conversation.id + '/cancel', { runId: run.id }); await refresh()
      }
    }
    const screen: TuiScreen = new TuiScreen(renderer, options.preferences, {
      send, interrupt, older, quit: () => quit(),
      inputMode:mode=>{saveTerminalSetting(options.cwd,'inputMode',mode,'user');options.preferences={...options.preferences,inputMode:mode}},
      queue:async(action,id,text)=>{
        if(action==='pause')queue.toggle()
        else if(id){
          if(action==='hold')queue.hold(id)
          else if(action==='release')queue.release(id)
          else if(action==='edit')queue.edit(id,text!)
          else if(action==='delete')queue.remove(id)
          else if(action==='up'||action==='down')queue.move(id,action==='up'?-1:1)
          else if(action==='steer'){await queue.deliver(id,'steer');await refresh()}
        }
        screen.run(pump())
      },
      copy: async text => {
        if (process.platform !== 'darwin') { renderer.copyToClipboardOSC52(text); return }
        await new Promise<void>((resolve, reject) => {
          const copy = spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] })
          copy.once('error', reject); copy.once('close', code => code === 0 ? resolve() : reject(Error('Could not copy text')))
          copy.stdin.end(text)
        })
      },
      command: input => commands.execute(input), complete: input => commands.complete(input), review: () => commands.review()
    })
    queue=new InputQueue(join(terminalProfileDirectory(),'queues',encodeURIComponent(client.base),conversation.id+'.json'),
      ()=>{if(!stopped)screen.inputQueue(queue.items,queue.paused,queue.sending)},async(item,mode)=>{
        const result=await client.send(conversation.id,item.text,item.files,Intl.DateTimeFormat().resolvedOptions().locale,{
          steer:mode==='steer',clientMessageId:item.id,attachments:item.attachments,uploaded:ids=>queue.uploaded(item.id,ids)
        })
        awaitingRun=result.runId
        if(result.delivery==='next-turn'&&routerProcessing(view))screen.notice('Sent. Router will read this at its next available turn.')
      })
    screen.inputQueue(queue.items,queue.paused)
    const commands: TuiCommands = new TuiCommands(client, conversation, screen, options, () => view, refresh, quit, older)
    renderer.once('destroy', () => quit())
    try {
      screen.setLoading(true); await refresh(); screen.setLoading(false)
      watch = client.watch(conversation.id, abort.signal, refresh, message => { if (!stopped) { screen.connection(false); screen.notice(message, true) } })
      if (options.prompt || options.files.length) await send(options.prompt, options.files.map(file => resolve(options.cwd, file)))
      await done
    } catch (error) {
      if (!abort.signal.aborted) throw error
    } finally {
      stopped = true; abort.abort(); screen.close(); await watch
    }
    return next
  })
}
