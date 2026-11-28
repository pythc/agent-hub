import assert from 'node:assert/strict'
import { createTestRenderer } from '@opentui/core/testing'
import { TuiScreen } from '../src/terminal/tui-screen.ts'
import type { Snapshot } from '../src/terminal/client.ts'
import type { InputMode } from '../src/terminal/input-queue.ts'

const test=await createTestRenderer({width:120,height:30,kittyKeyboard:true,useMouse:true})
const sent:{text:string;mode?:InputMode}[]=[],actions:{action:string;id?:string;text?:string}[]=[]
const screen=new TuiScreen(test.renderer,{theme:'dark',motion:'reduced'}, {
 send:async(text,_files,mode)=>{sent.push({text,mode})},command:async()=>{},complete:async()=>[],
 interrupt:async()=>{},older:async()=>{},review:async()=>{},quit:()=>{},
 queue:async(action,id,text)=>{actions.push({action,id,text})}
})
const view={conversation:{id:'personal',sequence:0,contextVersion:1},workers:[],calls:[],browsers:[],messages:[],approvals:[],tasks:[],schedules:[],deliveries:[],run:{id:'run',state:'running'},reply:{id:'reply',runId:'run',state:'running'}} as unknown as Snapshot
async function clickText(text:string){
 await test.renderOnce();const lines=test.captureCharFrame().split('\n'),y=lines.findIndex(line=>line.includes(text))
 assert.ok(y>=0,'visible '+text);await test.mockMouse.click(lines[y]!.indexOf(text)+1,y);await test.renderOnce()
}
try{
 screen.update(view);await test.renderOnce()
 const modeLabel=test.renderer.root.findDescendantById('input-mode')!
 const modelLabel=test.renderer.root.findDescendantById('composer-model')!
 const attachLabel=test.renderer.root.findDescendantById('attach-files')!
 assert.equal(modeLabel.y,modelLabel.y)
 assert.equal(modeLabel.y,attachLabel.y)
 assert.ok(modeLabel.x>=modelLabel.x+modelLabel.width&&modeLabel.x+modeLabel.width<=attachLabel.x)
 assert.match(test.captureCharFrame(),/Queue · enter submit/)
 await test.mockInput.pasteBracketedText('first');test.mockInput.pressEnter();await test.renderOnce()
 assert.deepEqual(sent,[{text:'first',mode:'queue'}])
 test.mockInput.pressKey('TAB');await test.renderOnce()
 assert.match(test.captureCharFrame(),/Steer · enter submit/)
 await test.mockInput.pasteBracketedText('correction');test.mockInput.pressEnter();await test.renderOnce()
 assert.equal(sent.at(-1)?.mode,'steer')
 await clickText('Steer · enter');assert.match(test.captureCharFrame(),/Queue · enter submit/)
 const entries=Array.from({length:12},(_,i)=>({id:'q'+i,text:'Pending '+i,files:[],contextVersion:1}))
 screen.inputQueue(entries,false);await test.renderOnce()
 const box=test.renderer.root.findDescendantById('input-queue')!
 for(let i=0;i<30;i++)await test.mockMouse.scroll(box.x+3,box.y+2,'down')
 await test.renderOnce()
 assert.match(test.captureCharFrame(),/Pending 11/)
 screen.openQueue();await clickText('1. Pending 0');await clickText('Move down')
 assert.ok(actions.some(a=>a.action==='down'&&a.id==='q0'))
 screen.openQueue();await clickText('1. Pending 0');await clickText('Edit')
 assert.equal(actions.at(-1)?.action,'hold')
 test.mockInput.pressKey('ESCAPE');await test.renderOnce()
 assert.equal(actions.at(-1)?.action,'release')
 screen.openQueue();await clickText('1. Pending 0');await clickText('Edit')
 assert.match(test.captureCharFrame(),/enter save · (shift\+enter|ctrl\+j) newline/)
 test.mockInput.pressEnter({shift:true});await test.mockInput.pasteBracketedText('补充说明')
 test.mockInput.pressEnter();await test.renderOnce()
 assert.ok(actions.some(a=>a.action==='edit'&&a.id==='q0'&&a.text==='Pending 0\n补充说明'))
 assert.equal(actions.at(-1)?.action,'release')
 const previousTerminal=process.env.TERM_PROGRAM
 process.env.TERM_PROGRAM='Apple_Terminal'
 screen.openQueue();await clickText('1. Pending 0');await clickText('Edit')
 if(previousTerminal===undefined)delete process.env.TERM_PROGRAM
 else process.env.TERM_PROGRAM=previousTerminal
 assert.match(test.captureCharFrame(),/enter save · ctrl\+j newline/)
 await clickText('Insert newline');await test.mockInput.pasteBracketedText('mouse newline')
 test.mockInput.pressEnter();await test.renderOnce()
 assert.ok(actions.some(a=>a.action==='edit'&&a.id==='q0'&&a.text==='Pending 0\nmouse newline'))
 screen.openQueue();await clickText('1. Pending 0');await clickText('Steer now')
 assert.ok(actions.some(a=>a.action==='steer'&&a.id==='q0'))
 screen.openQueue();await clickText('1. Pending 0');await clickText('Delete')
 assert.ok(actions.some(a=>a.action==='delete'&&a.id==='q0'))
 test.resize(60,20);screen.inputQueue(entries,true);await test.renderOnce()
 assert.ok(screen.draft.y+screen.draft.height<=20,'draft stays visible with a queued list')
 console.log('Queued input TUI passed: mode keys/clicks, submissions, scrolling, reorder, edit cancellation, steer, delete and resize')
}finally{screen.close();test.renderer.destroy()}
