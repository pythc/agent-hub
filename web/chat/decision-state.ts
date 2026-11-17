import type {BusinessDecisionView} from '../../src/business-decisions.ts';
export interface DecisionAttempt {action:'answer'|'renew';id:string;version:string;requestId:string;text?:string}
export function decisionStatus(d:BusinessDecisionView,now:number):BusinessDecisionView['status']{
 if(d.status!=='pending')return d.status;
 if(!Number.isFinite(now)||!Number.isFinite(d.expiresAt)||now<d.createdAt)return 'unavailable';
 return now>=d.expiresAt?'expired':'pending';
}
export function decisionAttempt(d:BusinessDecisionView,action:'answer'|'renew',text:string):DecisionAttempt{
 const answer=text.trim();if(action==='answer'&&(!answer||answer.length>10000))throw Error('invalid_answer');
 return Object.freeze({action,id:d.id,version:d.version,requestId:crypto.randomUUID(),...(action==='answer'?{text:answer}:{})});
}
/** One mounted question owns an immutable attempt; uncertain sends cannot change its answer. */
export class DecisionSubmission {
 private attempt:DecisionAttempt|null=null;
 private busy=false;
 private active=true;
 get pending(){return this.attempt}
 dispose(){this.active=false}
 async run(d:BusinessDecisionView,action:'answer'|'renew',text:string,request:(body:DecisionAttempt)=>Promise<unknown>){
  if(!this.active||this.busy)return 'ignored' as const;
  this.busy=true;
  try{
   if(this.attempt&&(this.attempt.id!==d.id||this.attempt.version!==d.version))throw Error('decision_context_changed');
   this.attempt??=decisionAttempt(d,action,text);
   await request(this.attempt);
   return this.active?'accepted' as const:'ignored' as const;
  }finally{this.busy=false}
 }
 clearRejected(){this.attempt=null}
}
