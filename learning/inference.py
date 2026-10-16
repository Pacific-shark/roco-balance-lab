"""Independent evaluation transport, leaving the training implementation frozen."""
import os
import queue
import shutil
import subprocess
import threading
from .bridge import BattleBridge, ROOT


class InferenceBridge(BattleBridge):
    # Reuse the tested request/timeout/cleanup methods. Only the child entry point
    # differs; do not change a running experiment's hashed training sources.
    def __init__(self,node=None,timeout=30):
        executable=node or os.environ.get('ROCO_NODE') or shutil.which('node')
        if not executable:raise RuntimeError('Set ROCO_NODE to Node.js 24+')
        self.timeout=timeout;self.lines=queue.Queue()
        self.process=subprocess.Popen([executable,str(ROOT/'scripts/inference-bridge.mjs')],cwd=ROOT,
            stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,encoding='utf-8',bufsize=1,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
        def read():
            for line in self.process.stdout:self.lines.put(line)
            self.lines.put(None)
        self.reader=threading.Thread(target=read,daemon=True);self.reader.start()
