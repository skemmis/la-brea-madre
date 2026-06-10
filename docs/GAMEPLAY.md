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
| Claim   | max($100, 30× its ticket $/day) | Take unowned land at its value. First ever claim: free, anywhere |
| Buyout  | the owner's asking price | Buy ANY rival parcel at its assessed price — paid to the owner |
| Upgrade | $200/$400/$800 | Level 1/2/3 — bigger pay multiplier |
| Repair  | $2 × degradation | Clear quake damage |

Free (no order): **Assess** — set your own parcel's price.

## Quakes — the maintenance tax

Real USGS earthquakes (polled every 30 minutes, M1.5+ near the basin) deal
degradation to owned parcels in a heat-map footprint around the epicenter
(Gaussian falloff; an M2 covers a district, an M3 a region). Degradation cuts income until repaired; repair costs an
order, and the order bank is capped — so the bigger the empire, the longer its
shaken edges bleed. The map's Seismic layer shows 30 days of shake heat; the
seismograph bulletin lists fresh events.

## The Assessment — every parcel is always for sale

Each parcel carries its owner's **self-assessed price** (defaulting to its
market value when claimed). Two rules make the map a market:

1. **Anyone may buy any parcel at its assessed price**, instantly — the money
   goes to the owner, improvements transfer with the deed.
2. **The county taxes every assessment 0.5%/day** at the tick. Can't pay, and
   parcels foreclose to the county, cheapest first.

Price high and you bleed tax; price low and someone takes the deal. Your own
number is your defense — honesty is the equilibrium, and a big empire pays a
big bill. There is no separate combat system: conquest IS purchase, at the
owner's own price.

## The Parking Oracle — the exchange

A daily board of ~16 YES/NO markets on the same real data: city totals
(tickets, fine $, dead animals), make face-offs and props, color and
violation props, neighborhood face-offs, the weekday special, and the Madre
special (will the ground move today?). LMSR market-maker pricing — the price
is the implied probability; buy and sell any time; each winning share pays $1.
Trading closes at midnight PT; settlement lands when the city publishes the
day's records (typically 1–2 days). Same dollars as the map.

## The daily tick (midnight PT)

1. Each parcel pays its ticket money.
2. Carrion in your territory becomes Work Orders (Mondays: +1 free for all).
3. Unapplied quakes deal their damage.
4. The county collects its tax on every assessment (foreclosures if unpaid).
5. The market board closes; tomorrow's slate opens.

## Testing

`npm run sim` plays months of bot-vs-bot gameplay through the production
rules on the real city's data shapes (see sim/). Balance constants all live
in `shared/core/config.ts`.
