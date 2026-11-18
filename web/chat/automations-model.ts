import type { WebhookGrant } from '../../src/webhooks.ts';

export type AutomationDraft = {
  triggerId: string; authorizationQuote: string; title: string; objective: string;
  workerId: string; resultPath: string; acceptance: string; namespace: string;
  eventSource: string; eventTypes: string; secretEnv: string; url: string; callbackSecret: string;
  hours: string; maxEvents: string; maxConcurrent: string; idempotent: boolean;
  parameters: string; continuations: string; transport: string; resultFiles: string;
  normalizerSourceId: string; customTask: boolean; criteria: string; nodes: string;
};
export type SavedAutomationSkill = { id: string; version: number; entryId: string; template: WebhookGrant['template'] };

export function defaultAutomationTask(d: AutomationDraft) {
  return {title:d.title,objective:d.objective,
    criteria:[{id:'result',description:d.acceptance,check:{kind:'file_exists',path:d.resultPath}}],
    nodes:[{id:'work',title:d.title,instruction:d.objective,workerId:d.workerId,criterionIds:['result'],dependsOn:[]}],
  };
}

export function automationCommand(d: AutomationDraft, operationId: string, now: number, skill?: SavedAutomationSkill) {
  const template=skill?.template??(d.customTask?{title:d.title,objective:d.objective,criteria:JSON.parse(d.criteria),nodes:JSON.parse(d.nodes)}:defaultAutomationTask(d));
  return {
    protocolVersion:2, receiving:false, operationId, triggerId:d.triggerId, authorizationQuote:d.authorizationQuote,
    namespace:d.namespace, eventSource:d.eventSource, eventTypes:d.eventTypes.split(',').map(s=>s.trim()).filter(Boolean),
    secretEnvs:[d.secretEnv], parameters:JSON.parse(d.parameters), continuations:JSON.parse(d.continuations),
    transport:JSON.parse(d.transport), ...(d.normalizerSourceId ? {normalizerSourceId:d.normalizerSourceId} : {}),
    template, ...(skill ? {skill:{id:skill.id,version:skill.version}} : {}),
    expiresAt:now+Number(d.hours)*3600000, maxEvents:Number(d.maxEvents), maxConcurrent:Number(d.maxConcurrent),
    callback:{url:d.url,secretEnv:d.callbackSecret,idempotent:d.idempotent,resultFiles:JSON.parse(d.resultFiles)},
  };
}

export function automationState(g: Pick<WebhookGrant,'active'|'receiving'|'expiresAt'>, now=Date.now()) {
  return !g.active ? 'revoked' : g.expiresAt <= now ? 'expired' : g.receiving ? 'active' : 'stopped';
}
