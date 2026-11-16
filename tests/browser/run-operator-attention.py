"""Start local fixture/browser/shutdown together. Never print cookie or raw DB data."""
import json,os,pathlib,subprocess,sys,time
os.umask(0o077)
root=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '.local/operator-attention-acceptance').resolve();root.mkdir(parents=True,exist_ok=True,mode=0o700)
if (root/'browser.json').exists():raise SystemExit('Use a fresh private acceptance directory')
result=1
with open(root/'host.log','w') as log:
 app=subprocess.Popen(['node','--import','tsx','examples/operator-attention-acceptance.ts',str(root)],stdout=log,stderr=subprocess.STDOUT)
 try:
  deadline=time.monotonic()+45
  while not (root/'browser.json').exists():
   if app.poll() is not None or time.monotonic()>deadline:raise RuntimeError('fixture_startup_failed')
   time.sleep(.1)
  env=os.environ.copy();env.setdefault('CHROMIUM_EXECUTABLE','/usr/bin/chromium')
  with open(root/'browser.log','w') as output:result=subprocess.run(['python3','tests/browser/operator-attention.py',str(root)],env=env,stdout=output,stderr=subprocess.STDOUT,timeout=210).returncode
  report=json.loads((root/'browser-report.json').read_text()) if (root/'browser-report.json').exists() else {'result':'failed','code':'browser_report_missing'}
  print(json.dumps({'result':report['result'],'groups':len(report.get('checks',[])),'screenshots':len(report.get('screenshots',[])),'pageErrorCount':report.get('pageErrorCount'),'modelCalls':report.get('modelCalls'),'report':str(root/'browser-report.json')}))
 except Exception:
  print(json.dumps({'result':'failed','code':'operator_attention_acceptance_failed'}));result=1
 finally:
  app.terminate()
  try:app.wait(timeout=12)
  except subprocess.TimeoutExpired:app.kill();app.wait()
sys.exit(result)
