import {GithubSource} from './github.ts'
import type {SourcePlugin} from '../../src/source-plugins.ts'
/** Compatibility registration. New deployments can replace this with the
 * immutable v2 package without changing the core registry. */
export default {apiVersion:1,kind:'github',label:'GitHub',create:config=>new GithubSource(config),observed:config=>!!config.github?.receiveAll,authorizeRead:GithubSource.authorizeRead,replayCursors:config=>[config.id]} satisfies SourcePlugin
