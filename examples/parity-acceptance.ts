import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {dirname,resolve} from 'node:path'
import {createHash} from 'node:crypto'
const [input,output='docs/acceptance/parity-2026-11-04.json']=process.argv.slice(2)
if(!input)throw Error('Provide the Linux acceptance report JSON')
const report=JSON.parse(readFileSync(input,'utf8'))
if(!report.passed||report.platform!=='linux'||report.failedTests||report.pendingTests)throw Error('Acceptance requires a passed, non-skipped Linux report')
const baseline=JSON.parse(readFileSync('docs/upstream-reference.json','utf8')),hashes=JSON.parse(readFileSync('docs/upstream-core-sha256.json','utf8'))
for(const [file,expected] of Object.entries(hashes))if(createHash('sha256').update(readFileSync('src/vendor/dsh-core/'+file)).digest('hex')!==expected)throw Error('Core source changed: '+file)
const selected:Record<string,string[]>={
 P01:['runtime'],P02:['upstream/core-engine'],P03:['runtime','wecom'],P04:['runtime','upstream/core-engine'],P05:['upstream/core-engine'],P06:['runtime'],P07:['runtime'],
 P09:['runtime','upstream/core-engine'],P10:['policy'],P11:['policy','connectors','wecom','office'],P12:['runtime'],P13:['runtime'],P14:['upstream/core-engine','settings-approval'],P15:['runtime','work'],P16:['upstream/core-engine','runtime'],P17:['upstream/core-engine'],P18:['work','sandbox','backend-api'],P19:['merge'],P20:['upstream/core-engine','runtime'],P21:['runtime','work','backend-api','wecom'],P22:['resources','settings-approval'],P23:['settings-approval','backend-api'],P24:['review','connectors','runtime'],P25:['settings-approval'],P26:['interface','runtime'],P27:['interface'],P28:['settings-approval','office'],P30:['interface'],P31:['interface','work'],P32:['sandbox','backend-api','office'],P33:['sandbox','codex','connectors'],P34:['clients','interface'],P35:['workspace','runtime'],P36:['work','runtime'],P37:['settings-approval'],P38:['sandbox','backend-api','office'],P39:['backend-api','wecom','interface'],P40:['backup'],P42:['upstream/core-engine'],P43:['upstream/core-engine'],P44:['interface','runtime'],P45:[],P46:['runtime','backup'],P47:['resources','wecom'],P48:['settings-approval','backend-api'],P51:['runtime','wecom'],
}
const live:Record<string,string>={
 P11:'Current office member-confirmation UI and isolated adapters; Feishu live connection authenticated, no fresh human event; real WeCom blocked by creation permissions.',
 P15:'Codex native continuation regression recorded separately; native desktop handoff is historical, not repeated in this run.',
 P18:'Real non-root Linux Bubblewrap processes, network boundaries, background lifecycle and API-to-shell paths passed; shortened timeouts do not prove a 30-minute soak.',
 P19:'Isolated merge tests only, as requested; no real GitHub merge.',
 P21:'Recovery fault cases and process shutdown passed; no new long-running production soak.',
 P23:'API next-request refresh passed; Codex in-turn injection evidence remains historical.',
 P27:'Current browser-tested office sender setup; other panel flows retain historical UI evidence.',
 P28:'Current browser-tested exact-sender allow-list save; not a new exhaustive UI audit.',
 P29:'Current browser search cases for task, event body, decision and uncertain delivery; event-body parent filtering defect fixed. No dedicated automated UI search case.',
 P32:'Real Linux sandbox process probe and existing Feishu bot authentication; commercial model credentials remain unverified.',
 P33:'No dedicated OS account or multi-tenant isolation acceptance.',
 P34:'Protocol profiles and historical desktop integrations; not all client product UIs were rerun.',
 P38:'Actual sandbox startup probe now detects blocked outer-container policy; this is not an API credential validation.',
 P39:'Full isolated HTTP/WebSocket runtime paths passed. Real WeCom explicitly deferred; fresh Feishu human-message round trip not repeated.',
 P40:'Actual 0.6.0 -> 0.7.0 -> restore 0.6.0 -> re-upgrade Runtime exercise passed; files and external side effects are outside DB rollback.',
 P47:'WeCom adds anchored cached message/media resources; it does not provide arbitrary group history.',
}
const rows=readFileSync('docs/PARITY.md','utf8').split('\n').filter(l=>/^\| P\d\d \|/.test(l)).map(l=>l.split('|').slice(1,-1).map(s=>s.trim()))
if(rows.length!==51||new Set(rows.map(r=>r[0])).size!==51)throw Error('Expected exactly 51 distinct prototype sections')
const sections=rows.map(([id,upstream,implementation,behavior])=>{
 const files=(id==='P45'?new Set(report.assertions.map((a:any)=>a.file)):new Set((selected[id!]??[]).map(n=>'tests/'+n+'.spec.ts')))
 const cases=report.assertions.filter((a:any)=>files.has(a.file))
 return {id,upstream,implementationMapping:implementation,behavior,automatedEvidence:{status:implementation==='说明'?'documentation':cases.length&&cases.every((a:any)=>a.status==='passed')?'matched_tests_passed':'no_current_test_mapping',testCount:cases.length,files:[...files],testNames:cases.map((a:any)=>a.name)},productAcceptance:live[id!]??(implementation==='说明'?'Documentation review; no runtime pass claimed.':'Matched automated evidence only; historical and external acceptance boundaries remain in PARITY.md.'),wholeSectionAcceptance:'not_claimed'}
})
const result={at:new Date().toISOString(),version:report.version,upstream:baseline,coreFilesVerified:Object.keys(hashes).length,sectionCount:sections.length,explanatorySections:sections.filter(s=>s.implementationMapping==='说明').length,linux:{kernel:report.kernel,architecture:report.architecture,uid:report.uid,tests:report.tests,passed:report.passed},scope:'Section-by-section evidence index, not 51/51 whole-product or all-platform acceptance. File-level test matching is not proof that every sentence of a section is verified.',sections}
mkdirSync(dirname(resolve(output)),{recursive:true});writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({output,sections:sections.length,explanatory:result.explanatorySections,withCurrentTestEvidence:sections.filter(s=>s.automatedEvidence.status==='matched_tests_passed').length,wholeProductAcceptanceClaimed:false}))
