/** Keep rows compact while making records from different days unambiguous. */
export function boardTimestamp(value:number|string,language:'en'|'zh-CN'){
  const date=new Date(value)
  if(!Number.isFinite(date.getTime()))return {label:'—',title:language==='en'?'Time unavailable':'时间不可用',dateTime:undefined}
  return {
    label:date.toLocaleTimeString(language,{hour:'2-digit',minute:'2-digit'}),
    title:date.toLocaleString(language,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'short'}),
    dateTime:date.toISOString(),
  }
}
