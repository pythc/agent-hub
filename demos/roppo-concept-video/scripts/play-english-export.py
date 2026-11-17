from pathlib import Path
import argparse,json
from playwright.sync_api import sync_playwright
parser=argparse.ArgumentParser();parser.add_argument('video',type=Path);args=parser.parse_args()
root=Path(__file__).resolve().parents[1];out=root/'.evidence/english';out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True);page=browser.new_page(viewport={'width':1280,'height':720})
 page.goto(args.video.resolve().as_uri());page.wait_for_function('document.querySelector("video")?.readyState>=2',timeout=30000)
 player=page.locator('video');metadata=player.evaluate('v=>({width:v.videoWidth,height:v.videoHeight,duration:v.duration,error:v.error?.message??null})')
 assert metadata['width']==1920 and metadata['height']==1080 and abs(metadata['duration']-177)<.01 and metadata['error'] is None,metadata
 player.evaluate('v=>{v.muted=true;v.controls=false;v.style.cssText="position:fixed;inset:0;width:100vw;height:100vh;object-fit:contain;background:#000";return v.play()}');page.wait_for_timeout(2200)
 played=player.evaluate('v=>{v.pause();return v.currentTime}');assert played>1,played
 for sec in [10,65,79,90,98,124,143,152,161,175]:
  player.evaluate('''(v,t)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('seek timeout')),10000);v.addEventListener('seeked',()=>{clearTimeout(timer);resolve(v.currentTime)},{once:true});v.currentTime=t;})''',sec)
  assert player.evaluate('v=>v.readyState>=2&&v.error===null')
  if sec in [90,152]:page.screenshot(path=str(out/f'video-playback-{sec}.png'))
 result={'passed':True,'metadata':metadata,'playedSeconds':played,'seekSeconds':[10,65,79,90,98,124,143,152,161,175]}
 (out/'browser-export.json').write_text(json.dumps(result,indent=2));print(json.dumps(result));browser.close()
