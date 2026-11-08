#!/usr/bin/env bash
# Pull the major road network for the map frame from OpenStreetMap (Overpass API)
# and save it compactly for generate-tampa-style.cjs. Output is gitignored.
# Fetches the frame as a 4x4 grid of small tiles (big single queries time out),
# trying several Overpass endpoints per tile, then merges and de-duplicates ways.
set -uo pipefail
cd "$(dirname "$0")"
mkdir -p data/tiles
S=33.93; W=-118.60; N=34.27; E=-118.12; G=4
ENDPOINTS=(https://overpass-api.de/api/interpreter https://maps.mail.ru/osm/tools/overpass/api/interpreter https://overpass.kumi.systems/api/interpreter)
for i in $(seq 0 $((G-1))); do for j in $(seq 0 $((G-1))); do
  out="data/tiles/t${i}${j}.json"; [ -s "$out" ] && continue
  bb=$(python3 -c "s,w,n,e,g,i,j=$S,$W,$N,$E,$G,$i,$j; dy=(n-s)/g; dx=(e-w)/g; print(f'{s+i*dy:.5f},{w+j*dx:.5f},{s+(i+1)*dy:.5f},{w+(j+1)*dx:.5f}')")
  q="[out:json][timeout:170];way[\"highway\"~\"^(motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link)\$\"]($bb);out geom;"
  ok=0
  for attempt in 1 2; do for ep in "${ENDPOINTS[@]}"; do
    if curl -sS --fail --max-time 200 -A "la-brea-madre-pulse-map/1.0" -G --data-urlencode "data=$q" "$ep" -o "$out.part" 2>/dev/null \
       && python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$out.part" 2>/dev/null; then
      mv "$out.part" "$out"; ok=1; echo "tile $i$j ok via ${ep#https://}"; break 2; fi
  done; sleep 5; done
  [ $ok = 1 ] || { echo "tile $i$j FAILED"; rm -f "$out.part"; }
done; done
node -e '
const fs=require("fs"); const seen=new Set(), out=[]; let tiles=0;
for(const f of fs.readdirSync("data/tiles")){ if(!f.endsWith(".json"))continue; tiles++;
  for(const e of JSON.parse(fs.readFileSync("data/tiles/"+f,"utf8")).elements){
    if(!e.geometry||seen.has(e.id))continue; seen.add(e.id);
    out.push({h:e.tags&&e.tags.highway||"?",c:e.geometry.map(p=>[p.lon,p.lat])}); } }
fs.writeFileSync("data/osm-roads-box.json",JSON.stringify(out));
console.log("merged",tiles,"of 16 tiles ->",out.length,"ways in data/osm-roads-box.json");'
