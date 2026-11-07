import {expect,it} from 'vitest'
import {sourceEvidence} from '../src/router-evidence.ts'
import {MessageSource} from '../src/sources.ts'
import {configSchema} from '../src/config.ts'

it('expands GitHub discussion aliases and pages only the anchored issue or pull request',async()=>{
 const config=configSchema.parse({sources:[{id:'github',kind:'local',cwd:'.',allowedActors:['alice']}]}).sources[0]!
 const source=new MessageSource({...config,kind:'github'}),reads:string[]=[]
 ;(source as any).read=async({resource}:{resource:string})=>{reads.push(resource);return {messages:[],next_resource:'github/issues/7/comments/2'}}
 const trigger=source.trigger({id:'one',thread:'owner/repo#7',text:'Comment',addressed:false},'alice')
 await sourceEvidence(source,trigger,'root');const page=await sourceEvidence(source,trigger,'thread');await sourceEvidence(source,trigger,page.next_resource)
 expect(reads).toEqual(['github/issues/7','github/issues/7/comments/1','github/issues/7/comments/2'])
 await expect(sourceEvidence(source,trigger,'github/issues/8/comments/1')).rejects.toThrow('outside this discussion')
 await expect(sourceEvidence(source,trigger,'github/commits/abcdef123/checks')).rejects.toThrow('outside this discussion')
})

it('returns Feishu pagination cursors usable by the same anchored reader',async()=>{
 const config=configSchema.parse({sources:[{id:'group',kind:'local',cwd:'.',allowedActors:['alice']}]}).sources[0]!
 const source=new MessageSource({...config,kind:'feishu'}),reads:string[]=[]
 ;(source as any).read=async({resource}:{resource:string})=>{reads.push(resource);return {messages:[],next_resource:'feishu/group:one/thread/next%2Fpage'}}
 const trigger=source.trigger({id:'one',thread:'chat:root',text:'Comment',addressed:false},'alice')
 const page=await sourceEvidence(source,trigger,'thread');expect(page.next_resource).toBe('thread/next%2Fpage');await sourceEvidence(source,trigger,page.next_resource)
 expect(reads).toEqual(['thread','thread/next%2Fpage'])
})
