# Cutting the Parking Pulse map — first pass

Two files, both **11.7 × 10 in** (fits the Aura's 12 × 12 bed). They stack: the face on top, the ocean board behind it.

| File | Material | What it does |
|------|----------|--------------|
| `face-layer.svg` | The same stock you cut the hole test in (that's what the 11.75 mm fit was measured on) | The land piece: cut to the coastline and frame edges, 45 pixel holes, streets and terrain scored, labels engraved |
| `ocean-layer.svg` | Backing board, e.g. 1/8" ply; stain it dark for the water | Full rectangle, 45 clearance holes (16 mm), depth lines + coastline guide scored, compass and title engraved |

## Colors → Glowforge steps

Each color comes in as its own step, so you can set power per step or switch any to **Ignore**.

| Color | Face layer | Ocean layer |
|-------|-----------|-------------|
| Blue `#0000FF` | **Cut**: coastline/frame outline + 45 holes | **Cut**: outer edge + clearance holes |
| Black `#000000` (filled) | **Engrave**: neighborhood labels | **Engrave**: compass + LOS ANGELES / CALIFORNIA |
| Red `#FF0000` | **Score**: freeways (the darkest line) | **Score**: depth lines |
| Orange `#FF8C00` | **Score**: major streets | **Score**: coastline guide (for gluing) |
| Green `#00A000` | **Score**: minor streets (optional; skip it to save time) | — |
| Purple `#9900CC` | **Score**: terrain contours (lightest) | — |
| Teal `#00AAAA` | **Score**: frame neatline | **Score**: neatline + compass ring |

## Order and settings

1. Run a **settings test on scrap first**: a small piece with a few labels, a street score and one hole. On a diode laser, score power is what sets how dark the lines read.
2. Run steps in the order **engrave → score → cut last**, so the piece can't shift before the detail work is done.
3. If the estimated time looks long, set **green (minor streets)** to Ignore. The map still reads well without them.

## Assembly

- Glue the face onto the ocean board. Line up the outer edges and the **orange coastline guide** scored on the board.
- The board's 16 mm clearance holes sit behind the face's 11.75 mm holes. They give the pixel's snap barbs and body room to seat. Push each pixel in from the back, the same way you did in the hole test.
- Where two clearance holes touched, they're cut as one merged opening. That's expected, and it's hidden behind the face.

## Rebuilding

```
node physical-pulse/generate-tampa-style.cjs   # layout (writes physical-pulse/data/layout.json)
python3 physical-pulse/build_cut_files.py      # these two SVGs (needs: pip install fonttools)
```

**Known gap in this pass:** the streets come from the app's own City-of-LA data, so the independent cities (Santa Monica, Beverly Hills, Culver City, Burbank, Glendale) show few streets. The full OpenStreetMap download failed today. When the Overpass servers cooperate, run `physical-pulse/fetch-osm-roads.sh` and rebuild to fill those areas in.
