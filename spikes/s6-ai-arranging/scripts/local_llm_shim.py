# SPDX-License-Identifier: MIT
"""Local stand-in for the AI node's /v1 (dev tool): serves Qwen3-8B (official Q4_K_M GGUF, the
same quantization Ollama ships as qwen3:8b) through llama.cpp with the node's contract subset:
GET /healthz, GET /v1/models, POST /v1/chat/completions (temperature, top_p, max_tokens, seed).
`reasoning_effort: "none"` renders Qwen3's empty think block, as the node's Ollama backend does.

  pip install llama-cpp-python diskcache   (CUDA wheels: --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu124)
  python local_llm_shim.py --model Qwen3-8B-Q4_K_M.gguf [--port 8791] [--token local-shim]
Then: CUCCIA_AI_BASE_URL=http://127.0.0.1:8791 CUCCIA_AI_TOKEN=local-shim node scripts/exp-chords.ts
"""
import argparse
import glob
import json
import os
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock

# Windows: CUDA wheels of llama-cpp-python need cudart/cuBLAS DLLs; take them from the
# nvidia-cuda-runtime-cu12 / nvidia-cublas-cu12 pip packages when installed.
if os.name == "nt":
    for d in glob.glob(os.path.join(sys.prefix, "Lib", "site-packages", "nvidia", "*", "bin")):
        os.add_dll_directory(d)
        os.environ["PATH"] = d + os.pathsep + os.environ["PATH"]

from llama_cpp import Llama  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--model", required=True)
ap.add_argument("--port", type=int, default=8791)
ap.add_argument("--token", default="local-shim")
ap.add_argument("--ctx", type=int, default=8192)
ap.add_argument("--gpu-layers", type=int, default=-1)
a = ap.parse_args()

llm = Llama(model_path=a.model, n_gpu_layers=a.gpu_layers, n_ctx=a.ctx, verbose=False)
lock = Lock()


def chatml(messages, think):
    out = []
    for m in messages:
        content = m["content"]
        if m["role"] == "assistant":
            content = re.sub(r"<think>[\s\S]*?</think>\s*", "", content)
        out.append(f"<|im_start|>{m['role']}\n{content}<|im_end|>\n")
    out.append("<|im_start|>assistant\n")
    if not think:
        out.append("<think>\n\n</think>\n\n")
    return "".join(out)


class H(BaseHTTPRequestHandler):
    def send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass

    def authed(self):
        if self.headers.get("Authorization") != f"Bearer {a.token}":
            self.send(401, {"error": "unauthorized"})
            return False
        return True

    def do_GET(self):
        if self.path == "/healthz":
            return self.send(200, {"ok": True, "busy": lock.locked(), "shim": "llama.cpp"})
        if not self.authed():
            return
        if self.path == "/v1/models":
            return self.send(200, {"object": "list", "data": [{"id": "qwen3:8b", "object": "model", "owned_by": "local-shim"}]})
        self.send(404, {"error": "not found"})

    def do_POST(self):
        if not self.authed():
            return
        if self.path != "/v1/chat/completions":
            return self.send(404, {"error": "not found"})
        req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        if req.get("model", "qwen3:8b") != "qwen3:8b":
            return self.send(403, {"error": "model not allowed"})
        prompt = chatml(req["messages"], think=req.get("reasoning_effort", "none") != "none")
        with lock:
            t0 = time.perf_counter()
            r = llm.create_completion(prompt, max_tokens=req.get("max_tokens") or 1024, temperature=req.get("temperature", 0.8),
                                      top_p=req.get("top_p", 0.95), seed=req.get("seed"), stop=["<|im_end|>", "<|endoftext|>"])
            dt = time.perf_counter() - t0
        u = r["usage"]
        self.send(200, {"id": r["id"], "object": "chat.completion", "model": "qwen3:8b",
                        "choices": [{"index": 0, "message": {"role": "assistant", "content": r["choices"][0]["text"]}, "finish_reason": r["choices"][0]["finish_reason"]}],
                        "usage": u, "shim": {"seconds": round(dt, 3), "backend": "llama.cpp", "model_file": a.model.replace("\\", "/").split("/")[-1]}})


print(f"local qwen3:8b shim on http://127.0.0.1:{a.port}", flush=True)
ThreadingHTTPServer(("127.0.0.1", a.port), H).serve_forever()
