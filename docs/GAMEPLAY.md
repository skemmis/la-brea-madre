# La Brea Madre — The Rulebook

You hold territory on a real map of Los Angeles. Real city records — parking
tickets, dead-animal reports, earthquakes — flow through your land and ARE the
game's economy. Everything resolves once a day at the midnight PT tick.

## The board

~11,200 hex parcels (H3 res 9, city-block scale) covering the City of LA's
actual land: the legal boundary intersected with the LA Times neighborhood
polygons — no open water, no county enclaves. You start with **$500 and
2 Work Orders**; your first claim is free and may be placed anywhere.

## Money ($)

An owned parcel pays the **actual parking-fine dollars the city writes inside
it each day**, times multipliers:

    pay = (ticket $/day + wells × $5)
          × (1 + upgrade bonus)        — +50% / +100% / +150% by level
          × (×2 if exploiting)
          × (1 − degradation/100)

Prime metered land prints thousands a day; hillsides print nothing.

## Work Orders — the action currency

Nearly every move costs 1 order. Orders come from **dead animals reported in
your territory** (1 per report, banked to a cap of 10) plus 1 free order with
Monday's tick. Carrion land is your action engine; ticket land is your income
engine — they are different places on the map, and that is the central
strategic tension.

## Actions (1 order + cost each)

| Action  | Cost | Effect |
|---|---|---|
| Claim   | max($100, 30× its ticket $/day) | Land is priced at its value. First ever claim: free, anywhere |
| Upgrade | $200/$400/$800 | Level 1/2/3 — bigger pay multiplier |
| Repair  | $2 × degradation | Clear quake damage |
| Contest | escrowed bid ($50 min) | Open a sealed-bid war (below) |
| Relic   | $600 | Passive yield perk |

Free (no order): toggle **Exploit** — ×2 income, +20 degradation/day; plunder
that ruins the parcel — and **Defend** in a war.

## Quakes — the maintenance tax

Real USGS earthquakes (polled every 30 minutes, M1.5+ near the basin) deal
degradation to owned parcels in a heat-map footprint around the epicenter
(Gaussian falloff; an M2 covers a district, an M3 a region), **doubled on
exploited parcels**. Degradation cuts income until repaired; repair costs an
order, and the order bank is capped — so the bigger the empire, the longer its
shaken edges bleed. The map's Seismic layer shows 30 days of shake heat; the
seismograph bulletin lists fresh events.

## Wars — sealed-bid sieges

Contest an enemy parcel adjacent to your territory: 1 order + an escrowed war
chest. The defender may secretly counter-commit any amount until midnight
(commitments stack). At the tick: higher purse takes the parcel (upgrades
transfer as spoils; exploit stance resets), the defender wins ties, the loser
recovers half their chest, and an undefended parcel falls to any legal bid.
Embattled parcels burn brick on the map.

## The Parking Oracle — the exchange

A daily board of ~16 YES/NO markets on the same real data: city totals
(tickets, fine $, dead animals), make face-offs and props, color and
violation props, neighborhood face-offs, the weekday special, and the Madre
special (will the ground move today?). LMSR market-maker pricing — the price
is the implied probability; buy and sell any time; each winning share pays $1.
Trading closes at midnight PT; settlement lands when the city publishes the
day's records (typically 1–2 days). Same dollars as the map.

## The Deck

$250 packs of three cards with passive exchange effects (payout multipliers,
loss refunds). Duplicates melt down for $80.

## The daily tick (midnight PT)

1. Each parcel pays its ticket money.
2. Carrion in your territory becomes Work Orders (Mondays: +1 free for all).
3. Unapplied quakes deal their damage.
4. Wars resolve (sealed bids open).
5. Exploited parcels degrade.
6. The market board closes; tomorrow's slate opens.

## Testing

`npm run sim` plays months of bot-vs-bot gameplay through the production
rules on the real city's data shapes (see sim/). Balance constants all live
in `shared/core/config.ts`.
