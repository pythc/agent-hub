/** Decode only the top-level Router reply string while its JSON document is still arriving. */
export function partialReply(raw:string):string|undefined{
  const prefix=/^\s*\{\s*"reply"\s*:\s*"/.exec(raw)
  if(!prefix)return
  let out=''
  for(let i=prefix[0].length;i<raw.length;i++){
    const c=raw[i]!
    if(c==='"')return out
    if(c==='\\'){
      const e=raw[++i];if(e===undefined)break
      if(e==='u'){
        const hex=raw.slice(i+1,i+5);if(hex.length<4)break
        if(!/^[\da-f]{4}$/i.test(hex))return
        const code=parseInt(hex,16);i+=4
        if(code>=0xd800&&code<=0xdbff){
          if(raw.slice(i+1,i+3)!=='\\u'||raw.length<i+7)break
          const low=raw.slice(i+3,i+7);if(!/^[\da-f]{4}$/i.test(low))return
          const unit=parseInt(low,16);if(unit<0xdc00||unit>0xdfff)return
          out+=String.fromCharCode(code,unit);i+=6
        }else if(code>=0xdc00&&code<=0xdfff)return
        else out+=String.fromCharCode(code)
      }else{
        const escapes:Record<string,string>={'"':'"','\\':'\\','/':'/','n':'\n','r':'\r','t':'\t','b':'\b','f':'\f'}
        if(!(e in escapes))return
        out+=escapes[e]
      }
    }else{
      const code=c.charCodeAt(0);if(code<32)return
      if(code>=0xd800&&code<=0xdbff){if(i+1>=raw.length)break;const low=raw.charCodeAt(i+1);if(low<0xdc00||low>0xdfff)return;out+=c+raw[++i]}
      else if(code>=0xdc00&&code<=0xdfff)return
      else out+=c
    }
  }
  return out
}
