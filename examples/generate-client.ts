import {writeFileSync,mkdirSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {clientConfig,type ClientId} from '../src/clients.ts'
const [client='generic',url='http://127.0.0.1:4319',tokenFile='.superagent/access-token',destination='examples/clients']=process.argv.slice(2)
const value=clientConfig({client:client as ClientId,url,tokenFile,root:resolve('.')})
mkdirSync(destination,{recursive:true});const file=join(destination,client+(client==='codex'?'.toml':'.json'));writeFileSync(file,value.text);console.log(resolve(file))
