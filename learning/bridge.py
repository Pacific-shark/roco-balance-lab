"""Persistent, batched subprocess transport. No network or desktop automation."""
from __future__ import annotations
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import threading

ROOT = Path(__file__).resolve().parents[1]


class BattleBridge:
    def __init__(self, node: str | None = None, timeout: float = 30):
        executable = node or os.environ.get("ROCO_NODE") or shutil.which("node")
        if not executable:
            raise RuntimeError("Node.js 24+ required; set ROCO_NODE to its executable")
        self.timeout = timeout
        self.lines: queue.Queue = queue.Queue()
        self.process = subprocess.Popen(
            [executable, str(ROOT / "scripts/learning-bridge.mjs")], cwd=ROOT,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, encoding="utf-8", bufsize=1,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        def read():
            for line in self.process.stdout:
                self.lines.put(line)
            self.lines.put(None)
        self.reader = threading.Thread(target=read, daemon=True)
        self.reader.start()

    def request(self, **payload):
        self.process.stdin.write(json.dumps(payload, separators=(",", ":")) + "\n")
        self.process.stdin.flush()
        try:
            line = self.lines.get(timeout=self.timeout)
        except queue.Empty as exc:
            self.close()
            raise TimeoutError("Local simulator response exceeded its time budget") from exc
        if line is None:
            raise RuntimeError("Local simulator exited before responding")
        result = json.loads(line)
        if not result["ok"]:
            raise ValueError(result["error"])
        return result["result"]

    def close(self):
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=3)
        for stream in (self.process.stdin, self.process.stdout):
            if stream:
                stream.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
