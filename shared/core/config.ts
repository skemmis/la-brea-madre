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
    startingCrude: 50,
    maxUpgrade: 3,
    seasonLength: undefined,
    costs: {
      claim: 10,
      firstClaimFree: true,
      upgrade: [20, 40, 80],
      relic: 60,
    },
    yield: {
      perWell: 3,
      upgradeBonus: [0, 0.5, 1.0, 1.5],
      exploitMultiplier: 2,
      exploitDegradePerTick: 20,
      volatility: 0.15,
      citationInfluence: 0.04,
      citationInfluenceCap: 0.25,
    },
    market: {
      liquidity: 100,
      payoutPerShare: 1,
    },
    pack: {
      cost: 25,
      size: 3,
      duplicateRefund: 8,
    },
    ...overrides,
  };
}
