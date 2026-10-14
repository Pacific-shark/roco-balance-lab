"""Re-fetch five public data tables, refusing changed source revisions.

python scripts/fetch_wiki_snapshot.py
python scripts/import_wiki.py .cache/wiki-snapshot
"""
import json
import shutil
import time
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path

repo = Path(__file__).resolve().parents[1]
cache = repo / '.cache' / 'wiki-snapshot'
(cache / 'wiki-api').mkdir(parents=True, exist_ok=True)
snapshot = json.loads((repo / 'public/data/bwiki-2026-10-14.json').read_text(encoding='utf-8'))
for source in (repo / 'docs/evidence').glob('bwiki-*.json'):
    shutil.copyfile(source, cache / source.name)
for module in snapshot['meta']['modules']:
    dest = cache / 'wiki-api' / (module['name'] + '.json')
    if dest.exists():
        print('cached:', module['name'])
        continue
    query = urllib.parse.urlencode({'action': 'parse', 'page': 'Module:Pets/data/' + module['name'],
        'prop': 'wikitext|revid', 'format': 'json'})
    request = urllib.request.Request('https://wiki.biligame.com/nrc/api.php?' + query)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = json.load(response)
    except urllib.error.URLError as error:
        raise SystemExit(f"BWIKI could not be read: {error}. Existing bundled data remains unchanged; no retry or alternate source is used.")
    if raw.get('parse', {}).get('revid') != module['revision']:
        raise ValueError(f'Unexpected revision or API error: {module["name"]}')
    dest.write_text(json.dumps(raw, ensure_ascii=False), encoding='utf-8')
    print('saved:', module['name'], module['revision'])
    time.sleep(1)
