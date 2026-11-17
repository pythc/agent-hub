import {mkdirSync} from 'node:fs'
import {join} from 'node:path'
export function isolatedEnvironment(root:string){
 for(const name of ['home','work','config','data','cache','state','tmp'])mkdirSync(join(root,name),{recursive:true,mode:0o700})
 return {NO_PROXY:'127.0.0.1,localhost'+(process.env.NO_PROXY?','+process.env.NO_PROXY:''),PWD:join(root,'work'),HOME:join(root,'home'),XDG_CONFIG_HOME:join(root,'config'),XDG_DATA_HOME:join(root,'data'),XDG_CACHE_HOME:join(root,'cache'),XDG_STATE_HOME:join(root,'state'),TMPDIR:join(root,'tmp'),NO_COLOR:'1',TERM:'dumb'}
}
