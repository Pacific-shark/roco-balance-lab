"""Resolve public BWIKI image references; no login, scraping or game client access.

The checked manifest is consumed offline by export-dex.mjs. Re-running only queries
missing files unless --refresh is supplied. Three workers, 40 titles per request.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import json
from pathlib import Path
import time
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "data/dex-image-manifest.json"
API = "https://wiki.biligame.com/nrc/api.php"


def request_batch(files):
    params = {"action": "query", "prop": "imageinfo", "iiprop": "url|size|mime",
              "titles": "|".join("File:" + f for f in files), "format": "json"}
    request = urllib.request.Request(API + "?" + urllib.parse.urlencode(params),
                                    headers={"User-Agent": "Mozilla/5.0 RocoEncyclopedia/1.0"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=35) as response:
                payload = json.load(response)
            if "query" not in payload:
                raise ValueError(str(payload)[:200])
            lookup = {p["title"].removeprefix("文件:").removeprefix("File:").replace("_", " "): p
                      for p in payload["query"]["pages"].values()}
            result = {}
            for filename in files:
                page = lookup.get(filename.replace("_", " "), {})
                info = page.get("imageinfo", [{}])[0]
                url = info.get("url")
                if url and urllib.parse.urlparse(url).hostname == "patchwiki.biligame.com":
                    result[filename] = {k: info[k] for k in ("url", "width", "height", "mime") if k in info}
            return result
        except Exception:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    snapshot = json.loads((ROOT / "data/catalog-s4-20261016-review.json").read_text(encoding="utf-8"))
    files = sorted({c["image"][kind] for c in snapshot["modules"]["Catalog"].values()
                    for kind in ("head", "illustration") if c.get("image", {}).get(kind)})
    existing = json.loads(MANIFEST.read_text(encoding="utf-8"))["files"] if MANIFEST.exists() else {}
    images = {} if args.refresh else existing
    pending = [f for f in files if f not in images]
    batches = [pending[i:i + 40] for i in range(0, len(pending), 40)]
    failures = []
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(request_batch, batch): batch for batch in batches}
        for future in as_completed(futures):
            try:
                images.update(future.result())
            except Exception as error:
                failures.append(str(error)[:200])
    output = {"resolvedAt": datetime.now(timezone.utc).isoformat(), "source": API,
              "files": {f: images[f] for f in files if f in images},
              "missing": [f for f in files if f not in images], "requestFailures": failures}
    MANIFEST.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"requested": len(files), "resolved": len(output["files"]),
                      "missing": len(output["missing"]), "failures": failures}, ensure_ascii=False))
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
