#!/usr/bin/env bash
# Rebuild physical-pulse/data/osm-roads-box.json (the road network for the map frame).
# Uses OpenFreeMap vector tiles (OpenStreetMap data). The Overpass API and Geofabrik
# refuse connections from some networks, cloud hosts included, so they aren't used.
# Needs: pip install mapbox-vector-tile
set -euo pipefail
cd "$(dirname "$0")/.."
python3 physical-pulse/fetch_osm_tiles.py
