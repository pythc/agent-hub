"""Run actual local app/browser in one namespace; synthetic provider/MCP only."""
import json,os,pathlib,subprocess,sys,time
os.umask(0o077)
root=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '.local/operation-errors-acceptance').resolve();root.mkdir(parents=True,exist_ok=True,mode=0o700)
if (root/'browser.json').exists():raise SystemExit('Use a fresh private acceptance directory')
shell=pathlib.Path(os.environ.get('CHROMIUM_EXECUTABLE','/workspace/scratch/f110c34c6b30/agent-hub-recovery/.local/browsers/chrome-headless-shell-linux64/chrome-headless-shell'))
if not shell.is_absolute() or not shell.is_file():raise SystemExit('Set CHROMIUM_EXECUTABLE to the verified absolute headless-shell path')
result=1;report={'result':'failed'}
with open(root/'host.log','w') as log:
 app=subprocess.Popen(['node','--import','tsx','examples/operation-errors-acceptance.ts',str(root)],stdout=log,stderr=subprocess.STDOUT)
 try:
  deadline=time.monotonic()+60
  while not (root/'browser.json').exists():
   if app.poll() is not None:raise RuntimeError('fixture_startup_failed')
   if time.monotonic()>deadline:raise RuntimeError('fixture_startup_timeout')
   time.sleep(.1)
  env=os.environ.copy();env['CHROMIUM_EXECUTABLE']=str(shell);env['ACCEPTANCE_IMPLEMENTATION_COMMIT']=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
  with open(root/'browser.log','w') as output:result=subprocess.run([sys.executable,'tests/browser/operation-errors.py',str(root)],env=env,stdout=output,stderr=subprocess.STDOUT,timeout=240).returncode
  report=json.loads((root/'browser-report.json').read_text()) if (root/'browser-report.json').exists() else {'result':'failed'}
 except Exception:report={'result':'failed','code':'operation_errors_acceptance_failed'};result=1
 finally:
  app.terminate()
  try:app.wait(timeout=12)
  except subprocess.TimeoutExpired:app.kill();app.wait()
# The host has exited and both log handles are closed before scanning. Never
# print marker-bearing contents; preserve private artifacts for investigation.
markers=[b'SYNTHETIC_M4_SENTINEL',b'SYNTHETIC_M4_RAW_BODY',b'SYNTHETIC_M4_ENV_NAME',b'SYNTHETIC_M4_STDERR']
counts={}
for filename in ['host.log','browser.log','browser-report.json']:
 path=root/filename
 if not path.is_file():result=1;counts[filename]=None;continue
 raw=path.read_bytes();counts[filename]=[raw.count(marker) for marker in markers]
 if any(counts[filename]):result=1
(root/'log-evidence.json').write_text(json.dumps({'artifactMarkerCounts':counts,'allZero':all(value is not None and not any(value) for value in counts.values())},indent=2))
if result:report['result']='failed'
report['artifactMarkerCounts']=counts
(root/'browser-report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False))
print(json.dumps({'result':report['result'],'groups':len(report.get('checks',[])),'screenshots':len(report.get('screenshots',[])),'pageErrorCount':report.get('pageErrorCount'),'artifactMarkerCounts':counts,'report':str(root/'browser-report.json')}))
sys.exit(result)
