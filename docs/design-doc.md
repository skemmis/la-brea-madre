# LA BREA MADRE — Working Design Doc
A free-to-play web game built on real Los Angeles open data and the city's occult / grotesque history. Working title; "La Brea Madre" is the cosmology, not necessarily the product name.

## 0. One-paragraph pitch
You hold territory on a real map of Los Angeles. Real-world open data — parking citations, dead-animal pickups, film permits, street trees, oil wells — flows through your land and feeds an engine you build, expand, and defend against other players. It presents as a bizarrely elaborate, deadpan-serious data toy about the most boring subject imaginable. Underneath, it is slowly excavating the city's cursed history, and the player gradually realizes the apparatus is far too large for its stated purpose. The disproportion is the first clue.
## North stars (tone + craft references)
- Papers, Please and Return of the Obra Dinn (both Lucas Pope) — the patron designer. A cold, forensic, deadpan interface that makes the player do the deduction, quietly loaded with dread. Mundane bureaucratic surface, real systemic depth, total straight face.
- Bobby Fingers — the monetization north star. Absurd, beautiful over-investment in niche subject matter; sells goods and depth, never power.
- Disco Elysium — the model for the eventual narrative/exploration layer: a washed-up investigator in a dense, strange, history-soaked district; skills as internal voices.
- Mulholland Drive / Chinatown / Sunset Boulevard / Under the Skin — the tonal canon. The bright dream peeled back to the black underneath; noir = "black"; the femme fatale who is the city itself.
- The felt register the whole thing is reaching for is one word: untoward. Not lurid horror — a quiet, pervasive wrongness, the sense that things here face the wrong direction.
## Non-negotiable guardrails
- Play money only. No real-money cash-out, ever (avoids gambling / CFTC exposure).
- No pay-to-win. Real money never buys power in the game economy. It buys only flavor and depth: artifacts, lore dossiers, ciphers, early access, head starts on real-world riddles (the Bobby Fingers model).
- Real-world riddles point only to public, legal locations. No trespassing, tunnels, night digs, private property. Safety first, always.
- Lore is seepage, never exposition. Artifacts and clans are named but never explained in-game. The player excavates; the game withholds. (See §3 and the "deployment" note below.)
- Data licensing is a real constraint. Prefer open government data (citations, wells, trees) which you can store and use freely. Commercial POI data (Google/Yelp) restricts storage — for those, run a periodic census and store only derived counts, not raw listings.
- Child safety + privacy. Play stays at the archetype level (e.g., "black Jeeps"), never per-vehicle/per-plate targeting, even though VIN/plate fields exist in the raw data.

# 1. INITIAL GAMEPLAY BUILD (the MVP)
The goal of v1 is the smallest loop that is genuinely fun, on real data, on a real map. Resist every urge to build the whole vision at once. If the core loop grips, everything else is seasoning. If it doesn't, no amount of lore saves it.
## 1.1 The map substrate
- Tile Los Angeles with an H3 hex grid (Uber's open-source hexagonal geospatial index).
  - Why H3: stable cell IDs, one-line "which hex is this lat/lng in?" lookup, clean 6-neighbor adjacency (perfect for a Risk-style contest system), and nested resolutions (free zoom tiers → later becomes the PvP-view / clan-view split).
- Pick a resolution that carves the city into the low thousands of plots, not tens of thousands. Tunable with one parameter.
- Do not use street blocks or census blocks as the unit (tens of thousands, wildly irregular — a balance and performance nightmare). Reference specific blocks/addresses only as deep-lore flavor.
- Layer real neighborhood names on top of the hexes for the UI ("you control most of Echo Park") and the eventual clan view. Hexes are the truth; names are the presentation.
## 1.2 The two resource types
- Ambient resources (your engine): slow, terrain-based, defined by what a plot is. Start with ONE clean, real, open-data ambient layer:
  - Oil derricks/wells (CalGEM — clean government data), or
  - Street trees / jacarandas (StreetsLA inventory — clean, open).
- Stochastic events (your weather): spiky, partly-random, partly-patterned bursts from what happens on a plot. Start with ONE event feed:
  - Parking citations (data.lacity.org, dataset 4f5p-udkv). The proven entrée. ~11M rows, attributes for make/color/violation/route/time/fine.
- The relationship: ambient = base rate; events = multipliers/spikes on the base.
## 1.3 The core daily loop
Persistent map, daily tick (events accrue all day; resolve at a set hour; players move once per day — a habit ritual).

- Your plots' ambient features produce a trickle of resource each tick.
- Events fire — some predictable (rain cancels street sweeping; Dodgers nights spike Chavez Ravine; first-of-month permit churn), some random — spiking or denting production.
- You spend accumulated resources to do one thing: claim an adjacent hex, or upgrade a hex you hold.
- Where your borders touch another player, contested hexes are resolved by whose events actually fired hotter there over the contest window. The real data is the dice — the city adjudicates the war.

That is a complete game: production, weather, a spend decision, expansion, conflict. Build and playtest exactly this before adding anything below.
## 1.4 The one decision that must be fun
A strategy game is only as good as the tradeoffs it forces. The v1 loop should already contain at least one real dilemma. The richest, and the one that carries the whole theme, is exploit vs. sustain: cash a plot in hard for a big short-term haul but degrade it, or tend it gently for steady lasting yield. (Cosmically: the greedy move feeds her.) Get this one tradeoff feeling good and you have a spine.
## 1.5 Data pipeline notes (for Claude Code)
- Events: periodic pull from the LA Socrata/SODA API; assign each record to an H3 cell by lat/lng; pre-aggregate counts per cell per day (do not query 11M raw rows live).
- Ambient: one-time (refreshed occasionally) geographic census; assign features to cells; store per-cell counts.
- Data hygiene: color/make codes are filthy and need normalization (White = WH/WI/WT/WE/W, etc.). Coordinates may be in CA State Plane Zone 5 — reproject to lat/lng.
- Storage/legal: government feeds are freely storable. For any commercial POI layer (e.g., metaphysical shops), store only derived counts, refresh quarterly, treat it as slow terrain.
## 1.6 Explicitly deferred to later (do NOT build in v1)
Prediction market, clans/factions, multiple resources, the narrative/disclosure mode, monetization, PvP at scale, seasons. All of it is §2.

# 2. FUTURE GAMEPLAY IDEAS & EXPANSIONS
Rough order of how they might layer on, not a commitment.
## 2.1 The full resource + clan system
- Three ambient resources mapped to the vertical cosmology (§3): oil derricks → BELOW (black / Lizard), crystal & metaphysical shops → ABOVE (celestial / seeker), jacarandas → MEMBRANE (glamour / Influencer). The real distribution of these features pre-sorts the city into clan-aligned regions.
- Clans emerge bottom-up, never assigned. A player who builds on derricks becomes de-facto Lizard; the map aggregates everyone's de-facto alignment. The clan identity arrives rather than being chosen — players discover what they are by what their land bleeds.
- The same event means different things to different clans — a dead-animal cluster is a feast for a Lizard, a blight for an Influencer. Plots become valuable to you, not universally. Synergy combos (Lizard + derrick plot + dead-animal event = jackpot) make players covet specific squares.
- Rarity as balance: derricks are rare and potent; jacarandas abundant and cheap. Scarcity tiers the resources and states the cosmology (the deep black is rare; the surface is everywhere and thin).
## 2.2 The two views
- PvP view: the micro war room — your plots, rivals, borders, contests.
- Clan view: the macro map — the whole city washed in faction color with a running tally ("the Lizard people control 34% of LA, up 3% this week"). The cosmic-war scoreboard, the rooting-interest engine, and the future governance/voting substrate. H3's nested resolutions give this split for free.
## 2.3 Decision depth (the strategy layer)
Specialize vs. diversify (power vs. fragility) · tall vs. wide · spend vs. bank · exploit vs. sustain · read-the-weather (position for predictable events). Plus resource sinks: expand, upgrade ambient features, fortify, buy artifacts/power-ups (earned resources only), perform one-time "rituals."
## 2.4 The runaway-leader problem (must solve before real PvP)
Positive feedback (more land → more resources → more land) makes the early leader snowball. Fixes, several of which are also lore:

- Upkeep / diminishing returns (empires are expensive).
- Quality over acreage (a small player on Hollywood beats a sprawling one on deserts).
- Coalitions (design for ganging up on the leader).
- Seasonal culls = the curse made mechanic. The map periodically rebalances; the biggest landholders get the Getty/Hughes entombment; every overlord doomed the way Petronilla doomed each owner of her land. The reset is the founding myth on a timer.
## 2.5 The prediction-market layer
- Parody real prediction markets (Polymarket / Kalshi) as closely as possible, but every market is parking/city-data based: "Will Fords be the most-ticketed make this week?" · "Will total tickets surpass $165k today?"
- Direct ancestor to study: Manifold (play-money markets + automated market maker).
- Use an automated market maker so prices feel alive and player-driven without dying at launch from no liquidity.
- Tempo: pair slow live markets with instant-resolution historical runs (Balatro-style, sealed archive days — the fast loop, the practice mode, the in-session dopamine) and staggered settlement clocks (some markets resolve by noon, some midnight, some Friday, some seasonal).
- Skill lives in the Bloomberg-terminal-for-parking — base rates + today's context (the tells) = edge. The terminal's elaborate polish IS the seriousness, the comedy, and the dread at once.
- This can fuse with territory (your plot is your franchise; the market is the league betting on everyone's franchises) or stand as its own mode.
## 2.6 The narrative / disclosure layer (the deep end)
- A genre-shift: the bright data game slowly cracks open into a brooding, Disco Elysium-style exploration of a dense, cursed district (candidate: Los Feliz — see §3 geography).
- Protagonist: the washed-up investigator — Marlowe's heir / a burnt-out parking-enforcement officer, the meter maid who is also the detective. The citation route is the noir beat.
- Obra Dinn-style frozen-death-tableaux: step into the preserved instant of a death and reconstruct it. The tar's preservation made playable. First case: Manly P. Hall's unsolved 1990 murder, with the "Angel Enema" as the clue.
- Most players never reach the bottom; the ones who do should feel they earned the horror by their own obsession.
## 2.7 Monetization (Bobby Fingers model)
Free core game. Paid tier sells artifacts, ebooks, ciphers, lore dossiers, early access, and head starts on real-world riddles (public legal locations only). Never power, never market advantage. The cursed relics you buy with cash are flavor and depth.
## 2.8 Real-world / ARG layer
Riddles that point to public, legal LA locations; the slow community-driven excavation of the lore; the "fuse" that, once a few obsessives discover the names are real and connected, recharges every withheld card with menace.

# 3. LORE / BACKGROUND (the bible)
Deployment rule (critical): none of this is ever explained to the player in-game. Artifacts are named, not annotated. Clans are felt, not described. The murder scenes come much later, if ever. The names and images are load-bearing because they are specific, grotesque, faintly wrong — and because they are real. The player who digs finds corroboration in the actual world, and the floor drops into reality. Keep it leaking; never empty, never explained.
## 3.1 The entity: La Brea Madre
A buried feminine presence beneath Los Angeles whose signature is not killing but keeping — preservation-by-catastrophe, the way the tar pits hold Ice Age animals frozen mid-death for fifty thousand years. She wears many masks across eras: the Feliz curse, Babalon, the boosters' denial, the femme fatale. La brea = "the tar." Noir = "black." She is the black pool that wears a woman's face, in the city that invented the form.
## 3.2 The cosmology: the vertical axis
A three-tier Hermetic structure — as above, so below — native to the occult tradition this material is steeped in.

- BELOW — black / tar / oil / the Lizards. The depths, extraction, the dead, the scavenge.
- ABOVE — white / celestial / rocketry / the seekers. The reach for transcendence (rockets, religions, manufactured messiahs). Not the good pole — to ascend is to flee the human, dissolve the body, the cult of escape.
- MEMBRANE — water / human / the surface, contested by Influencers (who sell the surface) and Vigilantes (who police it). Where people actually live; a thin precarious skin that is also a mirror (reflects the sky, hides the depths — the LA pool with the corpse in it).

Both poles pull humans off the membrane — down to be consumed, up to be dissolved. Keep it amoral and noir (white/water kills too — dams, drowning, Chinatown). Fire is not a pole but the event: the eruption when the poles fail to stay apart (methane, wildfire, the curse's fire).
## 3.3 The clans
- Lizards — the below; feed on the dead; oil/tar; the catacombs.
- Vigilantes — police the membrane; order, the leash, enforcement (the parking apparatus itself).
- Influencers — sell the membrane; glamour, surface, beauty, the dream-machine; the false healers and wellness grifters are their shadow.
- (Possible fourth: the Seekers / Celestial — the above pole, rocketry and religion — if the cast wants four.)
## 3.4 The historical tapestry (the cast)
Folklore is flagged as folklore; theory as theory. Everything else is documented.

The Feliz curse (folklore). Via Horace Bell's On the Old West Coast (1930): Don Antonio Feliz dies 1863; his blind niece Doña Petronilla is allegedly defrauded of Rancho Los Feliz and curses the land with flood and fire. The rancho becomes Griffith Park. A chain of doomed owners follows — including Griffith J. Griffith (first name and last name both Griffith), who in 1903 shot his wife in the face; she survived but lost an eye. He donated the park.

Manly P. Hall. Occult scholar, author of The Secret Teachings of All Ages; founded the Philosophical Research Society (3910 Los Feliz Blvd, architect Robert Stacy-Judd, Mayan Revival). Died 1990 — unsolved LAPD homicide; caretaker Daniel Fritz the prime suspect, having borrowed from Hall to market an "Essene" enema device called the "Water Angel," with which he gave the dying Hall near-daily enemas. The estate was signed to Fritz six days before death.

Jack Parsons. Co-founded JPL/Aerojet; Thelemite; ran the 1946 Babalon Working with L. Ron Hubbard to birth a "moonchild" messiah; lab sited near Devil's Gate ("portal to Hell"); died 1952 in a lab explosion, right arm never found. (The vertical axis incarnate: rockets up, portal down.)

L. Ron Hubbard. Pulp sci-fi writer in Parsons' circle → founded Dianetics/Scientology — the manufactured religion completing the engineered-messiah arc. LA fortresses (Big Blue, Celebrity Centre). Ran the faith from a fleet of ships (Sea Org). Rumored cursed manuscript Excalibur. The Xenu cosmology = buried catastrophe, volcanoes, trapped souls. PTA's The Master is based on him.

Howard Hughes. Fortune from his father's two-cone roller drill bit — the literal instrument that pierces the earth to the oil. Expanded up (aviation, Spruce Goose) and was funded by drilling down (the vertical axis again, Parsons' twin). The CIA's Glomar Explorer / Project Azorian used him as cover to raise a sunken Soviet sub → birthed "neither confirm nor deny" (the Glomar response — patron of the cover-up). Died 1976 in paranoid, drug-addicted seclusion — entombed alive, like Getty (the entity's signature: kept, not killed).

J. Paul Getty. Oil billionaire, paranoid miser. 1973: grandson John Paul Getty III kidnapped, ear severed and mailed (the "Getty Ear"); Getty paid minimally. The Getty Villa is a replica of the Villa dei Papiri at Herculaneum — buried by Vesuvius, preservation-by-catastrophe (echoes the tar and Hall's library).

Aimee Semple McPherson. Celebrity evangelist; Angelus Temple (Echo Park); pioneered religious radio. 1926: vanished swimming at the beach, reappeared five weeks later claiming kidnapping (widely believed a cover for an affair). Searchers died.

Edward Doheny. Drilled LA's first well, 1892, following the tar with a eucalyptus pole. The urban oil boom; thousands of derricks; disguised derricks (Cardiff Tower, THUMS islands — the "priesthood of the cap"). Greystone Mansion: his son Ned Doheny + secretary Plunkett, murder-suicide 1929, unsolved. Model for PTA's There Will Be Blood.

Elon Musk (living vertical axis). SpaceX (above/rockets, heir to Parsons-JPL) and The Boring Company (below/tunnels, heir to the catacombs) both originated in Hawthorne, LA County — the Boring test tunnel literally began at the SpaceX parking lot. HQs since moved to Texas (2024); the tunnel is now decommissioned and paved over (the below, buried again under a parking lot). One man drilling down and launching up.
## 3.5 The death-tableaux (the Obra Dinn cases) & the chain of struck-down women
- La Brea Woman (patient zero). The only human remains ever found in the tar pits (~10,000 years old, young woman); skull fractured by a blow — possibly LA's first murder, a cold case lost to time. Removed from museum display ~2004 (repatriation anxiety) — buried a second time. The first kept woman.
- The Black Dahlia. Elizabeth Short, 1947, Leimert Park. Bisected at the waist (the vertical axis written on a body), drained of blood (the black fluid taken), posed as a tableau (mistaken for a mannequin). Named for the black. Unsolved — the city's most famous cold case.
- The Glendower murder house. 2475 Glendower Place, Los Feliz, Dec 6 1959. Dr. Harold Perelson (a heart doctor) bludgeoned his sleeping wife Lillian with a ball-peen hammer (blow to the head), attacked daughter Judye (survived, fled), told the younger children "go back to bed, it was a nightmare," then took his own life clutching Dante's Divine Comedy (the poem of the descent — Inferno below, Paradiso above). The house then sat frozen, untouched, for ~60 years — a tar pit with a roof. On the same street (Glendower Ave) as the Frank Lloyd Wright Ennis House (Mayan Revival, the "Blade Runner house").
- Manson / Sharon Tate. Cielo Drive ("Heaven Drive"), Aug 1969 — the membrane tearing; Didion dated the death of the '60s to it. MKULTRA theory (theory, not fact): Tom O'Neill's CHAOS connects Manson's Haight-Ashbury orbit to MKULTRA psychiatrist Louis "Jolly" West; documented adjacencies, unprovable link — O'Neill himself admits the holes. The cover-story-over-the-buried-story made real; it never resolves (which is the point).
- Chinatown (the noir keystone). Polanski, 1974 — the water-grab conspiracy concealing incest (Noah Cross), the detective who learns everything and is powerless. "Forget it, Jake — it's Chinatown" = the membrane of denial slamming shut. Polanski directed it years after Tate's murder; his own later crime folds the film's horror back onto its maker. Evelyn Mulwray dies shot through the eye (rhymes with Griffith's wife; the recurring wound).

The women rhyme across deep time — La Brea Woman, the Black Dahlia, Sharon Tate, Lillian Perelson, Evelyn Mulwray — all young women destroyed, kept, posed, the truth lost. The same kept woman, the same blow, struck across the city's whole existence.
## 3.6 Cultural patron saints
- Lucas Pope (Papers Please, Obra Dinn) — the patron designer.
- David Lynch (Mulholland Drive) — the tonal crown. Died Jan 15 2025 after the Sunset Fire forced him from his home (off Mulholland, built by Frank Lloyd Wright's son). The chronicler of the city's dream-dread, taken by the curse's own element. The newest name in the ledger.
- Raymond Chandler / Philip Marlowe — Marlowe's apartment (the Hobart Arms, "a huge white stucco affair") on Franklin near Kenmore, at the foot of the Los Feliz hills; later a hillside house on Yucca Ave in Laurel Canyon. The genre's founding detective lived in the district.
- Joan Didion (dated the '60s' death to the Manson murders), James Ellroy (the Dahlia), Paul Thomas Anderson (the found "trilogy": There Will Be Blood, The Master, Inherent Vice), Sunset Boulevard (the dead man narrating from the pool).
## 3.7 Geography: the bounded district
Los Feliz is the candidate "Martinaise" — one dense, haunted block holding the murder house (Glendower Pl), the Mayan temple (Ennis House, Glendower Ave), the occult HQ (PRS, Los Feliz Blvd), and Petronilla's cursed Griffith Park. Franklin Avenue is a spine, threading Marlowe's Hobart Arms, the Black Dahlia's rented room, and the Scientology Celebrity Centre.
## 3.8 Personal origin
The whole project grows from a real corner: Vermont and Franklin, at the foot of the Los Feliz hills — the seed and the center. The game is, in part, an excavation of home. The washed-up investigator in the white stucco on Franklin was always partly the author.

Status: open jam, nothing finalized. This doc is a snapshot of the brainstorm, organized to start building from. Build §1. Dream §2. Keep §3 leaking.
