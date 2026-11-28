import { BoxRenderable, ScrollBoxRenderable, TextRenderable } from '@opentui/core'
import { withTerminalRenderer } from './renderer-session.ts'
import { paletteFor, themeNames, type ThemeName } from './themes.ts'
import { welcomeScene } from './setup-welcome.ts'
import { SetupCancelled } from './setup.ts'
import type { TerminalSettings } from './settings.ts'

export function chooseAppearance(prefs: TerminalSettings) {
  return withTerminalRenderer(async renderer => {
    const names = [...themeNames].sort()
    let theme: ThemeName = 'dark', companion = prefs.animation !== false, motion = prefs.motion !== 'reduced'
    let start = Date.now()
    let finish!: () => void, cancel!: () => void
    const done = new Promise<void>((resolve,reject) => { finish=resolve; cancel=()=>reject(new SetupCancelled()) })
    const page = new ScrollBoxRenderable(renderer,{width:'100%',height:'100%',paddingX:2,paddingY:1})
    renderer.root.add(page)
    const box = (parent: BoxRenderable | ScrollBoxRenderable, row=false) => {
      const node = new BoxRenderable(renderer,{flexDirection:row?'row':'column',flexShrink:0})
      parent.add(node); return node
    }
    const text = (parent: BoxRenderable | ScrollBoxRenderable, content: string, click?:()=>void) => {
      const node = new TextRenderable(renderer,{content,flexShrink:0,selectable:false,onMouseDown:e=>{if(e.button===0)click?.()}})
      parent.add(node); return node
    }
    const bar = box(page,true)
    const title = text(bar,'roppo / setup   ')
    const replay = text(bar,'↻ Replay [R]',()=>{start=Date.now();draw()})
    const sky = text(page,'')
    const heading = text(page,'Choose your terminal theme')
    const body = box(page,true)
    const list = box(body)
    list.width=17
    const select = (i:number) => { theme=names[(i+names.length)%names.length]!;draw() }
    list.onMouseScroll = event => {
      select(names.indexOf(theme)+(event.scroll?.direction==='up'?-1:1))
      event.stopPropagation()
    }
    const rows = names.map((name,i)=>text(list,name,()=>select(i)))
    const sample = box(body)
    sample.paddingX=2
    const role = text(sample,'Router')
    const question = text(sample,'Keep Saturday afternoon free.')
    const day = text(sample,'Saturday')
    const reply = text(sample,'I’ll leave the afternoon open.')
    const plan = text(sample,'/plan · Plan mode')
    const settings = box(page)
    const character = text(settings,'',()=>{companion=!companion;draw()})
    const animations = text(settings,'',()=>{motion=!motion;start=Date.now();draw()})
    const confirm = text(settings,'Continue [Enter]',finish)
    const hint = text(page,'↑/↓ or 1–8 to preview · Esc to cancel')
    function draw(){
      const p=paletteFor(theme,renderer.themeMode==='light')
      renderer.setBackgroundColor(p.bg)
      body.flexDirection=renderer.width<53?'column':'row'
      const elapsed=motion?Date.now()-start:1800
      sky.content=welcomeScene(Math.min(elapsed,1800),Math.min(64,Math.max(10,renderer.width-5)),companion).join('\n')
      for(const node of [title,hint])node.fg=p.muted
      for(const node of [sky,replay,role,plan,confirm])node.fg=p.accent
      for(const node of [heading,question,reply,character,animations])node.fg=p.fg
      day.fg=p.warm;sample.backgroundColor=p.panel
      rows.forEach((node,i)=>{
        const active=names[i]===theme
        node.content=(active?'❯ ':'  ')+(i+1)+' '+names[i]
        node.fg=active?p.accent:p.fg;node.bg=active?p.selected:p.bg
      })
      character.content=(companion?'[x]':'[ ]')+' Top companion [C]'
      animations.content=(motion?'[x]':'[ ]')+' Animations [A]'
    }
    renderer.keyInput.on('keypress',key=>{
      if(key.name==='escape'||(key.ctrl&&key.name==='c'))cancel()
      else if(key.name==='return')finish()
      else if(key.name==='up'||key.name==='down')select(names.indexOf(theme)+(key.name==='up'?-1:1))
      else if(/^[1-8]$/.test(key.name))select(Number(key.name)-1)
      else if(key.name==='c'){companion=!companion;draw()}
      else if(key.name==='a'){motion=!motion;start=Date.now();draw()}
      else if(key.name==='r'){start=Date.now();draw()}
    })
    renderer.on('resize',draw);renderer.on('theme_mode',draw);renderer.once('destroy',cancel)
    draw()
    const timer=setInterval(()=>{if(motion && Date.now()-start<1950)draw()},150)
    try { await done; return {theme,animation:companion,motion:motion?'full' as const:'reduced' as const} }
    finally { clearInterval(timer);renderer.off('resize',draw);renderer.off('theme_mode',draw) }
  })
}
