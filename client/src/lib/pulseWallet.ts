/**
 * The Pulse wallet — winnings from calling tickets on the map, kept in
 * localStorage until a logged-in visit to the floor converts them into the
 * real starting bankroll (POST /api/pulse/claim, once per account).
 */
export interface PulseWallet {
  bank: number; // dollars won so far
  wins: number; // correct calls, lifetime
  unlocked: boolean; // the corner has turned up
  claimed: boolean; // winnings already granted to a logged-in account
}

const WALLET_KEY = "pulseWallet";

export function loadWallet(): PulseWallet {
  try {
    const w = JSON.parse(localStorage.getItem(WALLET_KEY) || "");
    return {
      bank: Number(w.bank) || 0,
      wins: Number(w.wins) || 0,
      unlocked: !!w.unlocked,
      claimed: !!w.claimed,
    };
  } catch {
    return { bank: 0, wins: 0, unlocked: false, claimed: false };
  }
}

export function saveWallet(w: PulseWallet) {
  try {
    localStorage.setItem(WALLET_KEY, JSON.stringify(w));
  } catch {}
}
