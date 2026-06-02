/**
 * SOL-denominated PnL helpers (Meridian uses SOL as the canonical PnL unit).
 */

export function roundSol(value, decimals = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

/** PnL in SOL from a lessons.json performance record (supports legacy rows). */
export function perfPnlSol(entry) {
  if (entry?.pnl_sol != null && Number.isFinite(Number(entry.pnl_sol))) {
    return Number(entry.pnl_sol);
  }
  // Legacy: pnl_usd field sometimes stored SOL when solMode was on
  if (entry?.pnl_usd != null && Number.isFinite(Number(entry.pnl_usd))) {
    return Number(entry.pnl_usd);
  }
  return 0;
}

export function perfFeesSol(entry) {
  if (entry?.fees_earned_sol != null && Number.isFinite(Number(entry.fees_earned_sol))) {
    return Number(entry.fees_earned_sol);
  }
  if (entry?.fees_earned_usd != null && Number.isFinite(Number(entry.fees_earned_usd))) {
    return Number(entry.fees_earned_usd);
  }
  return 0;
}

export function perfInitialSol(entry) {
  if (entry?.initial_value_sol != null && Number.isFinite(Number(entry.initial_value_sol))) {
    return Number(entry.initial_value_sol);
  }
  if (entry?.initial_value_usd != null && Number.isFinite(Number(entry.initial_value_usd))) {
    return Number(entry.initial_value_usd);
  }
  return 0;
}

export function formatSolPnl(amount, { signed = false, decimals = 4 } = {}) {
  const n = roundSol(amount, decimals);
  const prefix = signed && n > 0 ? "+" : "";
  return `${prefix}${n} SOL`;
}

export function formatSolSymbol(amount, { signed = false, decimals = 4 } = {}) {
  const n = roundSol(amount, decimals);
  const prefix = signed && n > 0 ? "+" : "";
  return `${prefix}◎${n}`;
}
