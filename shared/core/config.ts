import type { BoardHex, GameConfig, PlayerId } from "./types";

/**
 * Default v1 tuning. All balance lives here so it can be adjusted without
 * touching the engine. Costs/yields mirror the original prototype values.
 */
export function defaultConfig(
  board: Record<string, BoardHex>,
  players: PlayerId[],
  overrides: Partial<GameConfig> = {}
): GameConfig {
  return {
    board,
    players,
    resolution: 7,
    startingCrude: 500, // dollars
    maxUpgrade: 3,
    seasonLength: undefined,
    costs: {
      claim: 100,
      claimValueMult: 30, // a parcel costs ~a month of its ticket money
      firstClaimFree: true,
      upgrade: [200, 400, 800],
    },
    yield: {
      finePayout: 1, // your hexes pay what the city tickets there, 1:1
      perWell: 5, // oil keeps a little flavor money
      upgradeBonus: [0, 0.5, 1.0, 1.5],
    },
    workOrders: {
      perCarrion: 1,
      weeklyFree: 1,
      cap: 10,
      starting: 2,
    },
    assessment: {
      taxRate: 0.005, // 0.5%/day of your own asking price — honesty has rent
      minPrice: 100,
    },
    quake: {
      // The Madre taxes value: full repair of a wreck ≈ 30% of fair value.
      repairFraction: 0.003,
      repairFloorPerPoint: 2,
    },
    works: {
      retrofitCostFraction: 0.05, // bolt down a prime parcel for 5% of its worth
      retrofitDamageMult: 0.5,
      crewCost: 250,
      crewMult: 1.5,
      crewDays: 7,
    },
    market: {
      liquidity: 1000,
      payoutPerShare: 1,
    },
    ...overrides,
  };
}
