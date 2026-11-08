"""Isolated acceptance adapter: real, locally cached embedding inference only.

Install model2vec==0.10.0 in an isolated environment; pass a model snapshot path.
The control/stats endpoints are test-only and the listener binds loopback.
"""
import argparse
import importlib.metadata
import json
import signal
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

parser = argparse.ArgumentParser()
parser.add_argument("--snapshot", required=True)
parser.add_argument("--engine", choices=["model2vec", "transformers"], default="model2vec")
args = parser.parse_args()
if args.engine == "model2vec":
    from model2vec import StaticModel
    model = StaticModel.from_pretrained(args.snapshot)

    def encode(text):
        return model.encode([text])[0].tolist()
else:
    import torch
    from transformers import AutoModel, AutoTokenizer
    torch.set_num_threads(2)
    tokenizer = AutoTokenizer.from_pretrained(args.snapshot, local_files_only=True)
    model = AutoModel.from_pretrained(args.snapshot, local_files_only=True).eval()

    def encode(text):
        tokens = tokenizer([text], padding=True, truncation=True, max_length=512, return_tensors="pt")
        # BGE's documented CLS pooling and L2 normalization, no query instruction.
        with torch.inference_mode():
            return torch.nn.functional.normalize(model(**tokens)[0][:, 0], p=2, dim=1)[0].tolist()

dimensions = len(encode("启动检查"))
lock = threading.Lock()
calls = []
faults = {}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def reply(self, status, body):
        encoded = json.dumps(body).encode()
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)
        except (BrokenPipeError, ConnectionResetError):
            pass  # Expected when the client aborts a fault-injected slow call.

    def do_GET(self):
        if self.path != "/stats":
            return self.reply(404, {})
        with lock:
            snapshot = [dict(call) for call in calls]
        self.reply(200, {"calls": snapshot})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.path == "/control":
            with lock:
                faults.clear()
                faults.update(body)
            return self.reply(200, {"ok": True})
        if self.path != "/embeddings":
            return self.reply(404, {})
        text = body["input"]
        started = time.monotonic()
        with lock:
            fault = dict(faults.get(text, {}))
            call = {"input": text, "state": "started", "model": body["model"]}
            calls.append(call)
        if fault.get("fail"):
            with lock:
                call.update(state="failed")
            return self.reply(503, {"error": "injected_unavailable"})
        vector = encode(text)
        with lock:
            call.update(state="inferred", dimensions=len(vector))
        time.sleep(fault.get("delayMs", 0) / 1000)
        self.reply(200, {"data": [{"index": 0, "embedding": vector}]})
        with lock:
            call.update(state="returned", elapsedMs=round((time.monotonic() - started) * 1000))


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
def stop(_signal, _frame):
    raise SystemExit(0)

signal.signal(signal.SIGTERM, stop)
print(json.dumps({"url": f"http://127.0.0.1:{server.server_port}", "snapshot": args.snapshot,
                  "library": args.engine, "version": importlib.metadata.version(args.engine),
                  "python": sys.version.split()[0], "dimensions": dimensions,
                  "torch": importlib.metadata.version("torch") if args.engine == "transformers" else None}), flush=True)
try:
    server.serve_forever()
finally:
    server.server_close()
