import type {PluginDefinition} from '../sdk.ts'
/** Reference projection for a signed CloudEvent carrying a nested CI batch. */
export default {
 create(config){return {config,webhook({schemaVersion,event}){
  if(schemaVersion!==1)throw Error('Unsupported normalizer input')
  const batch=(event.data.build as {batch?:unknown}|undefined)?.batch
  if(typeof batch!=='string'||!batch.trim())throw Error('A batch string is required')
  return {batch:batch.trim()}
 }}}
} satisfies PluginDefinition
