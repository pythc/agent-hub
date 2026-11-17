"""Start the actual fixture and browser in one cloud-local namespace."""
import os,pathlib,subprocess,sys,time
root=pathlib.Path(sys.argv[1]);root.mkdir(parents=True,exist_ok=True,mode=0o700)
if (root/'browser.json').exists():raise RuntimeError('Use a fresh private fixture directory')
with open(root/'host.log','w') as log:
 app=subprocess.Popen(['node','--import','tsx','examples/capability-increments-acceptance.ts',str(root)],stdout=log,stderr=subprocess.STDOUT)
 try:
  deadline=time.monotonic()+45
  while not (root/'browser.json').exists():
   if app.poll() is not None:raise RuntimeError('Local fixture startup failed; inspect private host log')
   if time.monotonic()>deadline:raise RuntimeError('Fixture startup deadline')
   time.sleep(.1)
  env=os.environ.copy();env.setdefault('CHROMIUM_EXECUTABLE','/usr/bin/chromium')
  with open(root/'workspace-browser.log','w') as log:result=subprocess.run(['python3','tests/browser/workspace-capabilities.py',str(root)],env=env,stdout=log,stderr=subprocess.STDOUT,timeout=240)
  print('Browser exit',result.returncode);print((root/'workspace-browser.log').read_text()[-6500:]);sys.exit(result.returncode)
 finally:
  app.terminate()
  try:app.wait(timeout=10)
  except subprocess.TimeoutExpired:app.kill();app.wait()
