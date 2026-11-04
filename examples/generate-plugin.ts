import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
const root = resolve('.')
const pluginRoot = join(root,'plugins/codex')
const args = [
  '--import', join(root,'node_modules/tsx/dist/loader.mjs'), join(root,'src/cli.ts'),
  'mcp', process.argv[2] ?? 'http://127.0.0.1:4319', resolve(process.argv[3] ?? '.superagent/access-token'),
]
writeFileSync(join(pluginRoot,'mcp.json'),JSON.stringify({
  $schema:'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
  mcpServers:{superagent:{type:'stdio',command:process.execPath,args}},
},null,2)+'\n')
writeFileSync(join(pluginRoot,'.mcp.json'),JSON.stringify({mcpServers:{superagent:{command:process.execPath,args}}},null,2)+'\n')
console.log(pluginRoot)
