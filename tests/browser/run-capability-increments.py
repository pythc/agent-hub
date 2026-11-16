"""Start fixture and browser in one cloud-local namespace; propagate real test failure."""
import subprocess,pathlib,time,os,sys
root=pathlib.Path(sys.argv[1]);root.mkdir(parents=True,exist_ok=True)
with open(root/'host.log','w') as log:
 app=subprocess.Popen(['node','--import','tsx','examples/capability-increments-acceptance.ts',str(root)],stdout=log,stderr=subprocess.STDOUT)
 try:
  deadline=time.monotonic()+30
  while not (root/'browser.json').exists():
   if app.poll() is not None:raise RuntimeError((root/'host.log').read_text())
   if time.monotonic()>deadline:raise RuntimeError('Fixture startup deadline')
   time.sleep(.1)
  env=os.environ.copy();shell=pathlib.Path('.local/browsers/chrome-headless-shell-linux64/chrome-headless-shell')
  if shell.exists():env.setdefault('CHROMIUM_EXECUTABLE',str(shell.resolve()))
  with open(root/'browser.log','w') as output:result=subprocess.run(['python3','tests/browser/capability-increments.py',str(root)],env=env,stdout=output,stderr=subprocess.STDOUT)
  print('Browser exit',result.returncode);print((root/'browser.log').read_text()[-6000:]);sys.exit(result.returncode)
 finally:
  app.terminate()
  try:app.wait(timeout=10)
  except subprocess.TimeoutExpired:app.kill();app.wait()
