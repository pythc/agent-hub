import {LayoutDashboard,Plug} from 'lucide-react'
import feishu from '../../src/ui/assets/feishu.ico?url'
import wecom from '../../src/ui/assets/wecom.ico?url'
import slack from '../../src/ui/assets/slack.png?url'
import linear from '../../src/ui/assets/linear.svg?url'
import github from '../../src/ui/assets/github-black.svg?url'
import githubDark from '../../src/ui/assets/github-white.svg?url'

const logos:Record<string,string>={feishu,wecom,slack,linear,github}
export function AppBrand({id,kind,category,size}:{id?:string;kind?:string;category?:string;size:number}){
  const key=kind??id?.replace(/^agenthub-/,''),src=key&&logos[key]
  if(category==='source'&&src)return <span className="market-app-brand" style={{width:size,height:size}} aria-hidden="true"><img className={key==='github'?'market-brand-light':undefined} src={src} alt=""/>{key==='github'?<img className="market-brand-dark" src={githubDark} alt=""/>:null}</span>
  const Icon=category==='source'?Plug:LayoutDashboard
  return <Icon size={size} aria-hidden="true"/>
}
