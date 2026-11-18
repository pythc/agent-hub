import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {it} from 'vitest'

it('waits for fixture SQLite locks without swallowing timeout or constraint failures',()=>{
  execFileSync('python3',[fileURLToPath(new URL('./container-sqlite-fixture.py',import.meta.url))],{stdio:'pipe',timeout:25000})
},30000)
