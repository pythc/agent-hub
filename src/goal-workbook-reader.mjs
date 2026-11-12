import {readFileSync} from 'node:fs'
import AdmZip from 'adm-zip'
import * as XLSX from 'xlsx'

/** Expand each ZIP member once under a shared budget. SheetJS sees only verified, stored members. */
function boundedWorkbook(bytes){
  // A flat binary key keeps the ZIP reader from synthesizing every directory prefix from untrusted names.
  const archive=new AdmZip(bytes,{decoder:{
    encode:value=>Buffer.from(value,'base64url'),decode:value=>Buffer.from(value).toString('base64url'),
  }})
  if(archive.getEntryCount()>4096)throw Error('Too many workbook parts')
  if(!archive.getEntry(Buffer.from('[Content_Types].xml').toString('base64url'))||!archive.getEntry(Buffer.from('xl/workbook.xml').toString('base64url'))||archive.getEntry(Buffer.from('Index.zip').toString('base64url')))throw Error('Expected an XLSX workbook')
  let expanded=0,compressed=0
  const stored=new AdmZip({noSort:true})
  for(const entry of archive.getEntries()){
    if(entry.isDirectory)continue
    const {size,compressedSize,method}=entry.header
    expanded+=size;compressed+=compressedSize
    if(!Number.isSafeInteger(expanded)||expanded>64*1024*1024||compressed>bytes.length||method===0&&size!==compressedSize)throw Error('Workbook exceeds ZIP budget')
    // adm-zip bounds DEFLATE output at size even if the central directory understates it.
    const content=entry.getData()
    if(content.length!==size)throw Error('Invalid workbook part size')
    const name=entry.rawEntryName.toString('utf8'),part=stored.addFile(name,content)
    if(part.entryName!==name)throw Error('Invalid workbook part name')
    part.header.method=0
  }
  return stored.toBuffer()
}

function workbookObservation(bytes,checks){
  const workbook=XLSX.read(boundedWorkbook(bytes),{type:'buffer',sheets:[...new Set(checks.map(c=>c.sheet))],cellFormula:false})
  const cells=checks.map(check=>{
    const sheet=workbook.Sheets[check.sheet],cell=sheet?.[check.cell.replace(/\$/g,'').toUpperCase()]
    const value=cell&&['s','n','b'].includes(cell.t)?cell.v:null
    let sum=null
    if(check.sumRange&&sheet){
      const {s,e}=XLSX.utils.decode_range(check.sumRange.replace(/\$/g,'').toUpperCase())
      const valid=e.r>=s.r&&e.c>=s.c&&e.r<1048576&&e.c<16384
      if(valid){
        sum=0
        for(const address of Object.keys(sheet)){
          if(address.startsWith('!'))continue
          const point=XLSX.utils.decode_cell(address)
          if(point.r<s.r||point.r>e.r||point.c<s.c||point.c>e.c)continue
          const item=sheet[address]
          if(item.t==='e'){sum=null;break}
          if(item.t==='n')sum+=item.v
        }
      }
    }
    return {sheet:check.sheet,cell:check.cell,value,...(check.sumRange?{range:check.sumRange,sum}:{})}
  })
  return {sheets:workbook.SheetNames,cells}
}

try{
 const observation=workbookObservation(readFileSync(0),JSON.parse(process.argv[2]))
 process.stdout.write(JSON.stringify(observation))
}catch{
 process.stderr.write('Workbook could not be read')
 process.exitCode=1
}
