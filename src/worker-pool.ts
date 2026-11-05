import type {Config} from './config.ts'
import type {WorkerProfile} from './backend-config.ts'
export function workerProfiles(config:Config):WorkerProfile[]{
 return config.execution.workers??Array.from({length:config.concurrency},(_,index)=>({id:'worker-'+(index+1),backend:config.execution.roles.worker??config.execution.backend,...(config.models.worker?{model:config.models.worker}:{})}))
}
export function normalizeWorkerCount(config:Config){if(config.execution.workers)config.concurrency=config.execution.workers.length}
