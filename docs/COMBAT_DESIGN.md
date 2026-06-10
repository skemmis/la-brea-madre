# Combat v2 — The Encounter (design)

Status: SUPERSEDED — replaced by the Assessment (Harberger) economy in GAMEPLAY.md. Kept for the record. The current sealed-bid contest (see
GAMEPLAY.md) is the v1 this replaces. Sim findings motivating it: warlord
became the apex strategy once land was priced at value (conquest cheaper
than purchase), and repeated contests drain defenders even when they win
(the harassment pump).

## The encounter

1. **Declaration** (attacker): 1 Work Order + sealed war chest + up to 2
   sealed EDGES (combat cards/relics).
2. **Response** (defender, until midnight): sealed counter-commit $ + up to
   2 edges. Neither side sees the other's commitments.
3. **Resolution** at the tick, in fixed layers (deterministic, stack-like):
   cancels → multipliers → flat adds → aftermath riders.
   Higher total takes the parcel; defender wins ties.
4. **Settlement is second-price**: winner pays max(loser total + $1, minBid),
   remainder of escrow returns; loser recovers half. (Kills the harassment
   pump: crushing a tiny probe no longer costs the defender their chest.)

**Garrison:** the defender gets a free intrinsic bonus =
upgradeLevel × 15% of parcel value — upgrades are fortifications, and
absentees aren't free meat.

## Edges (combat cards; same packs as exchange cards)

| Edge | Effect |
|---|---|
| Pinkerton Men | +$1,000 to defense (flat add) |
| Crooked Assessor | Attack ×1.3 vs a parcel richer than your richest |
| Injunction | Cancel the opponent's strongest edge |
| Night Survey | Reveal the defender's committed edges before lock |
| Yellow Journalism | If you lose, the winner pays the city double |
| Sandbags | +garrison this fight; halves quake damage at home |
| Company Doctor | Your tapped edges recover in 3 days, not 7 |

## Anti-snowball brakes

1. **The city sides with the little guy**: bid power ×
   (defenderParcels / attackerParcels)^0.25, clamped [0.75, 1.5].
2. **Edge exhaustion**: a committed edge is tapped for 7 days — wide wars
   drain the hand.
3. **War weariness**: each declaration within a rolling week doubles the
   declarer's next minimum bid.
4. **Truce**: a parcel that survives a siege is immune to that attacker for
   7 days.

Together with shipped systems: quakes tax empire AREA, order scarcity taxes
empire UPKEEP, these tax empire AGGRESSION.

## Acceptance (via npm run sim)

- Warlord win-rate vs active defenders ≈ 25%; vs conceders stays high.
- No persona holds >35% of claimed parcels at day 120.
- Defender cash is not drained by lost attacker probes (harassment dead).

## Open questions

- Edge acquisition: packs only, or also earned by play?
- Hand size: 2 sealed slots, or 3+ for deeper combos?
- Should a fully passive player be conquerable at all (garrison tuning)?
