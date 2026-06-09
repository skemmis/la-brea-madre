# Self-hosted map glyphs

SDF glyph PBFs for the MapLibre base map (`HexMap.tsx` → `glyphs: "/fonts/{fontstack}/{range}.pbf"`).

- Face: **Libre Baskerville** (Regular, Bold) — SIL Open Font License 1.1.
- Ranges: `0-255`, `256-511` — covers all Latin text in `/geo` label sources
  (verified ASCII-only). Add more ranges here if label data ever grows accents
  beyond Latin-1/Extended-A.
- Generated PBFs sourced from the VersaTiles fonts build
  (https://github.com/versatiles-org/versatiles-fonts), vendored so the sheet
  has no runtime dependency on third-party servers.
