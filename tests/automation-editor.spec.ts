import {expect,it} from 'vitest';
import {automationCommand,automationState,type AutomationDraft,type SavedAutomationSkill} from '../web/chat/automations-model.ts';
import {webhookGrantSchema} from '../src/webhooks.ts';

const draft:AutomationDraft={triggerId:'local:approval',authorizationQuote:'Please process signed build events.',title:'Build report',objective:'Review the failed build and write result.json.',workerId:'one',acceptance:'Explain the build failure and the verification result.',resultPath:'result.json',namespace:'build-events',eventSource:'https://example.com/events',eventTypes:'ci.failed, ci.retried',secretEnv:'IN_KEY',url:'https://example.com/results',callbackSecret:'OUT_KEY',hours:'24',maxEvents:'100',maxConcurrent:'1',idempotent:true,parameters:'{"batch":{"type":"string","maxLength":100}}',continuations:'[]',transport:'{"kind":"standard"}',resultFiles:'["result.json"]',normalizerSourceId:'',customTask:false,criteria:'[]',nodes:'[]'};

it('turns the simple form into one Worker task with declared acceptance evidence',()=>{
  const command=webhookGrantSchema.parse(automationCommand(draft,'operation',1000));
  expect(command).toMatchObject({triggerId:draft.triggerId,authorizationQuote:draft.authorizationQuote,operationId:'operation',receiving:false,expiresAt:86401000,maxConcurrent:1,eventTypes:['ci.failed','ci.retried']});
  expect(command.template.nodes).toHaveLength(1);
  expect(command.template.nodes[0]).toMatchObject({workerId:'one',criterionIds:['result'],instruction:draft.objective});
  expect(command.template.criteria[0]).toMatchObject({description:draft.acceptance,check:{kind:'file_exists',path:'result.json'}});
  expect(command.callback.resultFiles).toEqual(['result.json']);
  expect(()=>webhookGrantSchema.parse(automationCommand({...draft,idempotent:false},'other',1000))).toThrow();
});

it('keeps pinned skill contracts intact instead of rebuilding their task graph',()=>{
  const template=webhookGrantSchema.parse(automationCommand(draft,'source',1000)).template;
  const skill:SavedAutomationSkill={id:'saved-skill',entryId:'entry',version:3,template:{...template,maxRepairs:2,maxReplans:1,plan:['Retain the accepted process']}};
  const command=automationCommand({...draft,title:'ignored',criteria:'invalid JSON',nodes:'invalid JSON',customTask:true},'operation',1000,skill);
  expect(command.skill).toEqual({id:skill.id,version:3});
  expect(command.template).toBe(skill.template);
  expect(webhookGrantSchema.parse(command).template).toEqual(skill.template);
});

it('retains custom multi-node task rules and surfaces invalid JSON before sending',()=>{
  const criteria=[{id:'check',description:'Read the report',check:{kind:'file_exists',path:'report.md'}}];
  const nodes=[{id:'first',title:'Research',instruction:'Research',workerId:'one',criterionIds:['check'],dependsOn:[]},{id:'second',title:'Verify',instruction:'Verify research',workerId:'two',criterionIds:['check'],dependsOn:['first']}];
  const command=automationCommand({...draft,customTask:true,criteria:JSON.stringify(criteria),nodes:JSON.stringify(nodes)},'operation',1000);
  expect(command.template.nodes).toEqual(nodes);expect(command.template.criteria).toEqual(criteria);
  expect(()=>automationCommand({...draft,parameters:'{broken'},'operation',1000)).toThrow(SyntaxError);
});

it('shows expired active grants as expired and preserves revoked status',()=>{
  expect(automationState({active:true,receiving:true,expiresAt:100},100)).toBe('expired');
  expect(automationState({active:false,receiving:false,expiresAt:100},200)).toBe('revoked');
  expect(automationState({active:true,receiving:false,expiresAt:300},200)).toBe('stopped');
});
