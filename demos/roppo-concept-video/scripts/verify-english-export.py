"""Validate the English MP4 without making external application calls."""
from pathlib import Path
import argparse, hashlib, json, struct, subprocess
parser=argparse.ArgumentParser();parser.add_argument('video',type=Path);args=parser.parse_args()
root=Path(__file__).resolve().parents[1];video=args.video.resolve()
bin=root/'node_modules/@remotion/compositor-darwin-arm64';out=root/'.evidence/english';out.mkdir(parents=True,exist_ok=True)
probe=subprocess.run([str(bin/'ffprobe'),'-v','error','-show_format','-show_streams','-of','json',str(video)],cwd=bin,check=True,text=True,capture_output=True)
metadata=json.loads(probe.stdout);streams=[s for s in metadata['streams'] if s['codec_type']=='video'];assert len(streams)==1
v=streams[0]
assert (v['width'],v['height'],v['codec_name'],v['pix_fmt'],v['avg_frame_rate'],int(v['nb_frames']))==(1920,1080,'h264','yuv420p','30/1',5310),v
assert abs(float(metadata['format']['duration'])-177)<.01
subprocess.run([str(bin/'ffmpeg'),'-hide_banner','-v','error','-xerror','-i',str(video),'-map','0:v:0','-c:v','rawvideo','-f','null','-'],cwd=bin,check=True,capture_output=True)
frames=out/'mp4-frames';frames.mkdir(exist_ok=True)
for sec in [10,40,65,79,90,98,124,143.5,152,161,175]:
 subprocess.run([str(bin/'ffmpeg'),'-hide_banner','-v','error','-ss',str(sec),'-i',str(video),'-frames:v','1','-update','1','-y',str(frames/f'{sec}.png')],cwd=bin,check=True,capture_output=True)
boxes={}
with video.open('rb') as f:
 while f.tell()<video.stat().st_size:
  start=f.tell();header=f.read(8)
  if len(header)<8:break
  size,name=struct.unpack('>I4s',header)
  if size==1:size=struct.unpack('>Q',f.read(8))[0]
  if size==0:size=video.stat().st_size-start
  assert size>=8
  boxes[name.decode('ascii',errors='replace')]=start;f.seek(start+size)
assert boxes['moov']<boxes['mdat'],boxes
result={'path':str(video),'resolution':'1920x1080','fps':30,'frames':5310,'durationSeconds':177,'bytes':video.stat().st_size,'sha256':hashlib.sha256(video.read_bytes()).hexdigest(),'allFramesDecoded':True,'fastStart':True,'metadata':metadata}
(out/'mp4-validation.json').write_text(json.dumps(result,indent=2));print(json.dumps({k:v for k,v in result.items() if k!='metadata'}))
