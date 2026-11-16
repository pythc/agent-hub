"""Start the synthetic host and actual browser together in one cloud namespace."""
import json,os,pathlib,subprocess,sys,time
os.umask(0o077)
root=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '.local/credential-information-acceptance').resolve();root.mkdir(parents=True,exist_ok=True,mode=0o700)
if (root/'browser.json').exists():raise SystemExit('Use a fresh private acceptance directory')
shell=pathlib.Path(os.environ.get('CHROMIUM_EXECUTABLE','/workspace/scratch/f110c34c6b30/agent-hub-recovery/.local/browsers/chrome-headless-shell-linux64/chrome-headless-shell'))
if not shell.is_absolute() or not shell.is_file():raise SystemExit('Set CHROMIUM_EXECUTABLE to the verified absolute headless-shell path')
result=1
with open(root/'host.log','w') as log:
 app=subprocess.Popen(['node','--import','tsx','examples/credential-information-acceptance.ts',str(root)],stdout=log,stderr=subprocess.STDOUT)
 try:
  deadline=time.monotonic()+45
  while not (root/'browser.json').exists():
   if app.poll() is not None:raise RuntimeError('fixture_startup_failed')
   if time.monotonic()>deadline:raise RuntimeError('fixture_startup_timeout')
   time.sleep(.1)
  env=os.environ.copy();env['CHROMIUM_EXECUTABLE']=str(shell);env['ACCEPTANCE_IMPLEMENTATION_COMMIT']=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
  with open(root/'browser.log','w') as output:result=subprocess.run([sys.executable,'tests/browser/credential-information.py',str(root)],env=env,stdout=output,stderr=subprocess.STDOUT,timeout=240).returncode
  report=json.loads((root/'browser-report.json').read_text()) if (root/'browser-report.json').exists() else {'result':'failed'}
  print(json.dumps({'result':report['result'],'groups':len(report.get('checks',[])),'screenshots':len(report.get('screenshots',[])),'pageErrorCount':report.get('pageErrorCount'),'report':str(root/'browser-report.json')}))
 except Exception:print(json.dumps({'result':'failed','code':'credential_information_acceptance_failed'}));result=1
 finally:
  app.terminate()
  try:app.wait(timeout=12)
  except subprocess.TimeoutExpired:app.kill();app.wait()
sys.exit(result)
