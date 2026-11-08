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
parser.add_argument("--reranker-snapshot")
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
if args.reranker_snapshot:
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer
    torch.set_num_threads(2)
    rerank_tokenizer = AutoTokenizer.from_pretrained(args.reranker_snapshot, local_files_only=True)
    rerank_model = AutoModelForSequenceClassification.from_pretrained(args.reranker_snapshot, local_files_only=True).eval()

    def rerank(query, documents):
        with torch.inference_mode():
            tokens = rerank_tokenizer([[query, doc] for doc in documents], padding=True,
                                     truncation=True, max_length=512, return_tensors="pt")
            return torch.sigmoid(rerank_model(**tokens).logits.view(-1).float()).tolist()

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
        is_rerank = self.path == "/rerank" and args.reranker_snapshot
        if self.path != "/embeddings" and not is_rerank:
            return self.reply(404, {})
        text = body["query"] if is_rerank else body["input"]
        started = time.monotonic()
        with lock:
            fault = dict(faults.get(self.path + ':' + text, faults.get(text, {})))
            call = {"input": text, "state": "started", "model": body["model"], "path": self.path}
            if is_rerank:
                call["documents"] = body["documents"]
            calls.append(call)
        if fault.get("fail"):
            with lock:
                call.update(state="failed")
            return self.reply(503, {"error": "injected_unavailable"})
        if is_rerank:
            scores = rerank(text, body["documents"])
            result = {"results": [{"index": i, "relevance_score": score} for i, score in enumerate(scores)]}
        else:
            vector = encode(text)
            result = {"data": [{"index": 0, "embedding": vector}]}
        with lock:
            call.update(state="inferred")
            if is_rerank:
                call["scores"] = scores
            else:
                call["dimensions"] = len(vector)
        time.sleep(fault.get("delayMs", 0) / 1000)
        self.reply(200, result)
        with lock:
            call.update(state="returned", elapsedMs=round((time.monotonic() - started) * 1000))


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
def stop(_signal, _frame):
    raise SystemExit(0)

signal.signal(signal.SIGTERM, stop)
print(json.dumps({"url": f"http://127.0.0.1:{server.server_port}", "snapshot": args.snapshot,
                  "library": args.engine, "version": importlib.metadata.version(args.engine),
                  "python": sys.version.split()[0], "dimensions": dimensions,
                  "torch": importlib.metadata.version("torch") if args.engine == "transformers" else None,
                  "rerankerSnapshot": args.reranker_snapshot}), flush=True)
try:
    server.serve_forever()
finally:
    server.server_close()
