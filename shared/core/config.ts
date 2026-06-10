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
      relic: 600,
    },
    yield: {
      finePayout: 1, // your hexes pay what the city tickets there, 1:1
      perWell: 5, // oil keeps a little flavor money
      upgradeBonus: [0, 0.5, 1.0, 1.5],
      exploitMultiplier: 2,
      exploitDegradePerTick: 20,
    },
    workOrders: {
      perCarrion: 1,
      weeklyFree: 1,
      cap: 10,
      starting: 2,
    },
    combat: {
      minBid: 50,
      loserRefund: 0.5,
    },
    quake: {
      repairPerPoint: 2, // a fully wrecked parcel costs $200 to fix
      exploitedDamageMult: 2,
    },
    market: {
      liquidity: 1000,
      payoutPerShare: 1,
    },
    pack: {
      cost: 250,
      size: 3,
      duplicateRefund: 80,
    },
    ...overrides,
  };
}
