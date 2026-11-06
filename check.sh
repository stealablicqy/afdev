#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
node --check public/js/supabase-client.js
node --check public/js/db.js
node --check public/js/games.js
node --check public/js/music.js
node --check public/js/app.js
node --check public/sw.js
node --input-type=module --check < worker.js
python3 - <<'PY2'
import json, re
from pathlib import Path
root=Path('public')
json.loads((root/'manifest.webmanifest').read_text())
required=['index.html','css/app.css','css/desync-inspired.css','css/af-music.css','css/browser.css','js/supabase-client.js','js/db.js','js/games.js','js/music.js','js/app.js','sw.js','assets/af-mark.svg','assets/tab-calc.svg','assets/tab-notes.svg','assets/tab-calendar.svg']
for p in required:
    assert (root/p).is_file(), f'Missing required file: {p}'
html=(root/'index.html').read_text()
for p in re.findall(r'(?:src|href)=["\']([^"\']+)["\']', html):
    if p.startswith(('http://','https://','#','data:','mailto:')): continue
    clean=p.split('?',1)[0]
    if clean and not clean.endswith('.webmanifest'):
        assert (root/clean).exists(), f'Missing local HTML reference: {clean}'
games=(root/'js/games.js').read_text()
for asset in re.findall(r"art:'([^']+)'", games):
    assert (root/asset).is_file(), f'Missing game art: {asset}'
worker=Path('worker.js').read_text()
assert "@cf/zai-org/glm-4.7-flash" in worker
assert "env.AI.run(MODEL" in worker
assert "api.audius.co/v1" in worker
assert "musicProvider:'Audius'" in worker
assert "youtubeKeyRequired:false" in worker
assert "const CACHE = 'af-hub-desync-inspired-v7'" in (root/'sw.js').read_text()
assert "'./css/af-music.css'" in (root/'sw.js').read_text()
assert "url.pathname==='/api/music/search'" in worker
assert "url.pathname==='/api/search'" in worker
assert "html.duckduckgo.com/html/" in worker
app=(root/'js/app.js').read_text()
assert 'window.open(urls[engine]' not in app
assert 'window.open(app.url' not in app
assert 'af-browser-tabbar' in app
assert 'data-browser-back' in app
music=(root/'js/music.js').read_text()
assert "const API = '/api/music'" in music
assert "audio.src=`${API}/stream/" in music
assert 'Search Apple Music' not in music
assert 'musicSearchSource' not in music
assert "musicSearchForm'" in music
print('Project checks passed: JavaScript syntax, Worker syntax, in-app tabs and search route, Audius audio-only music wiring, manifest, local page assets, and game cover paths.')
PY2
