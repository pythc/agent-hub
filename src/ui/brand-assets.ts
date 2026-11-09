import {readFileSync} from 'node:fs'

// Shared by the standalone guide and the compiled workspace. Bundled assets
// keep private workspaces independent of third-party image requests.
const files:Record<string,[string,string]>={
 feishu:['feishu.ico','image/x-icon'],wecom:['wecom.ico','image/x-icon'],
 slack:['slack.png','image/png'],linear:['linear.svg','image/svg+xml'],
 github:['github-black.svg','image/svg+xml'],githubDark:['github-white.svg','image/svg+xml'],
}
export const entryBrandAssets=Object.fromEntries(Object.entries(files).map(([id,[file,mime]])=>[
 id,'data:'+mime+';base64,'+readFileSync(new URL('assets/'+file,import.meta.url)).toString('base64'),
]))
