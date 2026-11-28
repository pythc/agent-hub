import {expect,it} from 'vitest'
import {TerminalCompanion,drawCompanion,brailleCells} from '../src/terminal/companion.ts'
import type {Snapshot} from '../src/terminal/client.ts'
const snapshot=():Snapshot=>({conversation:{id:'personal',sequence:10},run:{id:'turn',state:'completed'},messages:[],workers:[],tasks:[],calls:[],browsers:[],handoffs:[]} as unknown as Snapshot)
it('does not replay old handoffs, plays new exchanges, and drops hidden exchanges',()=>{
 const view=snapshot(),companion=new TerminalCompanion(1000)
 const transfer={id:'handoff',sequence:10,ticketId:'task',from:{id:'router',label:'Router',kind:'router'},to:{id:'one',label:'Research',kind:'worker'}} as Snapshot['handoffs'][number]
 view.handoffs=[transfer]
 companion.update(view,true,false,true,1000)
 expect(companion.frame(3000).label).not.toContain('→')
 view.conversation.sequence=11;view.handoffs=[{...transfer,id:'next',sequence:11}]
 companion.update(view,true,false,true,3000)
 expect(companion.frame(3000).label).toContain('→')
 expect(companion.frame(9100).label).not.toContain('→')
 view.conversation.sequence=12;view.handoffs=[{...transfer,id:'hidden',sequence:12}]
 companion.update(view,true,false,false,10000);companion.update(view,true,false,true,11000)
 expect(companion.frame(11000).label).not.toContain('→')
})
it('settles completed history to idle and keeps reduced motion frames still',()=>{
 const view=snapshot(),companion=new TerminalCompanion(1000)
 companion.update(view,true,false,true,1000)
 expect(companion.frame(1000).phase).toBe('idle')
 expect(companion.frame(2000,true).pixels).toEqual(companion.frame(7000,true).pixels)
 view.run!.state='running';companion.update(view,true,false,true,8000)
 expect(companion.frame(8000).phase).toBe('thinking')
 view.run!.state='completed';companion.update(view,true,false,true,9000)
 expect(companion.frame(9000).phase).toBe('completed')
 expect(companion.frame(11500).phase).toBe('idle')
})

it('uniformly enlarges the original dots without reintroducing holes in tilted frames',()=>{
 for(const [phase,time] of [['completed',1600],['thinking',1900]] as const){
  const pixels=drawCompanion(phase,time)
  expect(pixels[8]![15]).toBe(1)
  expect(brailleCells(pixels).flat().every(cell=>cell.text===' '||/^[\u2800-\u28ff]$/.test(cell.text))).toBe(true)
 }
 const idle=drawCompanion('idle',0)
 const dots=idle.flatMap((row,y)=>row.flatMap((value,x)=>value?[{x,y}]:[]))
 expect(Math.max(...dots.map(p=>p.x))-Math.min(...dots.map(p=>p.x))+1).toBe(10)
 expect(Math.max(...dots.map(p=>p.y))-Math.min(...dots.map(p=>p.y))+1).toBe(12)
 expect(idle[6]![19]).toBe(0)
 expect(idle[6]![22]).toBe(0)
})

it('keeps two equal eyes with a visible bridge and intact face borders',()=>{
 const open=drawCompanion('idle',0),closed=drawCompanion('completed',0)
 for(const x of [19,22]){
  expect([open[6]![x],open[7]![x]]).toEqual([0,0])
  expect([open[6]![x-1],open[6]![x+1]]).toEqual([1,1])
  expect(closed[6]!.slice(x,x+2)).toEqual([0,0])
  expect(closed[5]!.slice(x,x+2)).toEqual([1,1])
  expect(closed[7]!.slice(x,x+2)).toEqual([1,1])
 }
 expect(closed[6]![21]).toBe(1)
 expect(closed[6]![24]).toBe(1)
})
