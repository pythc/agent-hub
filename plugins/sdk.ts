/** AgentHub plugin SDK v2. Bundle this module with the plugin; no host module is loaded at runtime. */
export {MessageSource,UncertainDelivery,bodyDigest,stableDigest} from '../src/sources.ts'
export type {SourceConfig} from '../src/config.ts'
export type {SourceChange} from '../src/sources.ts'
/** Only these record operations exist in the process facade. Host authorization and task writes are unavailable. */
export type PluginStore=Pick<import('../src/store.ts').Store,'get'|'list'|'put'> & {threads:Pick<import('../src/store.ts').Store['threads'],'list'>;triggers:Pick<import('../src/store.ts').Store['triggers'],'get'>}
export type SourceContext=Omit<import('../src/sources.ts').SourceContext,'store'> & {store:PluginStore}
export type {Trigger,OutboundMessage} from '../src/vendor/dsh-core/index.ts'
export type {PluginManifest} from '../src/plugin-package.ts'
export type {RepositoryAccess,RepositoryMethods,RepositoryUpdate} from '../src/repository-source.ts'
export interface PluginDefinition {create(config:import('../src/config.ts').SourceConfig,context?:SourceContext&{beforeRepositoryWrite():Promise<void>}):import('../src/sources.ts').Source}

export {records,record,recordPages} from './records.ts'
export type {RecordQuery,RecordPage} from '../src/sources.ts'
