import { writeFileSync,mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import {loadConfig} from '../src/config.ts'
const root=resolve('.'), config=resolve(process.argv[2]??'examples/config.json')
const settings=loadConfig(config)
if(!settings.port)throw Error('LaunchAgents require a fixed nonzero port')
mkdirSync(join(root,'deployment'),{recursive:true});mkdirSync(settings.stateDir,{recursive:true,mode:0o700})
const xml=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
for(const [role,tail] of [['host',['supervise',config]],['watchdog',['watch','http://127.0.0.1:'+settings.port,join(settings.stateDir,'access-token')]]] as const){
 const args=[process.execPath,'--import',join(root,'node_modules/tsx/dist/loader.mjs'),join(root,'src/cli.ts'),...tail]
 const label='cn.local.agent-hub.'+role
 const content='<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>'+label+'</string><key>ProgramArguments</key><array>'+args.map(a=>'<string>'+xml(a)+'</string>').join('')+'</array><key>WorkingDirectory</key><string>'+xml(root)+'</string><key>EnvironmentVariables</key><dict><key>PATH</key><string>'+xml(process.env.PATH??'/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin')+'</string><key>GODEBUG</key><string>http2client=0</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>5</integer><key>StandardOutPath</key><string>'+xml(join(settings.stateDir,role+'.out.log'))+'</string><key>StandardErrorPath</key><string>'+xml(join(settings.stateDir,role+'.error.log'))+'</string></dict></plist>\n'
 writeFileSync(join(root,'deployment',label+'.plist'),content)
}
