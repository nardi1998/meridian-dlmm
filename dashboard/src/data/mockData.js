/** Mock dashboard data — all monetary values in SOL */

export const SOL_PRICE_MOCK = 148.5;

export const agentStatus = {
  running: true,
  lastCycle: "2 min ago",
  agents: [
    { name: "Hunter Alpha", role: "Screening", interval: "30m", status: "active" },
    { name: "Healer Alpha", role: "Position mgmt", interval: "10m", status: "active" },
  ],
};

export const overview = {
  totalBalanceSol: 288.42,
  balanceChange24h: 2.4,
  pnlSol: 25.87,
  pnlPercent: 9.86,
  activePositions: 4,
  feesEarnedSol: 8.41,
  feesChange24hSol: 0.12,
  solPrice: SOL_PRICE_MOCK,
};

export const positions = [
  {
    id: "pos_1",
    position: "7xKp…m2Qa",
    pair: "SOL / USDC",
    pool: "Meteora DLMM",
    sizeSol: 83.5,
    pnlPercent: 12.4,
    pnlSol: 9.2,
    feesSol: 2.11,
    status: "in_range",
    binStep: 10,
  },
  {
    id: "pos_2",
    position: "9mRt…k4Pb",
    pair: "JUP / SOL",
    pool: "Meteora DLMM",
    sizeSol: 55.2,
    pnlPercent: -2.1,
    pnlSol: -1.15,
    feesSol: 1.28,
    status: "out_of_range",
    binStep: 25,
  },
  {
    id: "pos_3",
    position: "4nWs…h8Lc",
    pair: "BONK / SOL",
    pool: "Meteora DLMM",
    sizeSol: 37.7,
    pnlPercent: 5.8,
    pnlSol: 2.05,
    feesSol: 2.84,
    status: "in_range",
    binStep: 50,
  },
  {
    id: "pos_4",
    position: "2pVq…j6Nd",
    pair: "WIF / USDC",
    pool: "Meteora DLMM",
    sizeSol: 66.0,
    pnlPercent: 3.2,
    pnlSol: 2.04,
    feesSol: 2.18,
    status: "in_range",
    binStep: 15,
  },
];

export const closedPositions = [
  {
    id: "pos_c1",
    position: "8aLm…p3Kf",
    pair: "SAMO / USDC",
    pool: "Meteora DLMM",
    sizeSol: 42.1,
    pnlPercent: -8.2,
    pnlSol: -3.76,
    feesSol: 1.05,
    status: "closed",
    binStep: 20,
    closedAt: new Date(Date.now() - 5 * 3600000).toISOString(),
    closeReason: "Low yield: fee/TVL below minimum after 7d hold",
  },
  {
    id: "pos_c2",
    position: "3bTn…q9Wx",
    pair: "POPCAT / SOL",
    pool: "Meteora DLMM",
    sizeSol: 28.6,
    pnlPercent: 14.3,
    pnlSol: 3.58,
    feesSol: 2.42,
    status: "closed",
    binStep: 40,
    closedAt: new Date(Date.now() - 28 * 3600000).toISOString(),
    closeReason: "Trailing TP: peak 18.2% → current 14.3%",
  },
  {
    id: "pos_c3",
    position: "5cHp…r2Yz",
    pair: "RENDER / SOL",
    pool: "Meteora DLMM",
    sizeSol: 51.0,
    pnlPercent: 6.1,
    pnlSol: 2.94,
    feesSol: 3.18,
    status: "closed",
    binStep: 15,
    closedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    closeReason: "Take profit threshold reached",
  },
];

export const opportunities = [
  { id: "opp_1", pair: "PYTH / SOL", volume24h: 4.2e6, apr: 142.5, feeTvl: 0.38, score: 92, highlight: true },
  { id: "opp_2", pair: "RAY / USDC", volume24h: 2.8e6, apr: 98.2, feeTvl: 0.29, score: 88, highlight: true },
  { id: "opp_3", pair: "ORCA / SOL", volume24h: 1.9e6, apr: 76.4, feeTvl: 0.22, score: 81, highlight: false },
  { id: "opp_4", pair: "mSOL / SOL", volume24h: 3.1e6, apr: 54.1, feeTvl: 0.18, score: 74, highlight: false },
  { id: "opp_5", pair: "JTO / USDC", volume24h: 1.2e6, apr: 61.8, feeTvl: 0.21, score: 69, highlight: false },
];

export const decisions = [
  {
    id: "dec_1",
    ts: "2026-05-24T14:32:00Z",
    type: "deploy",
    actor: "Hunter Alpha",
    pool: "PYTH/SOL",
    summary: "Opened new LP position",
    reason: "High fee/TVL (0.38), organic score 92, volume spike +24%",
  },
  {
    id: "dec_2",
    ts: "2026-05-24T14:10:00Z",
    type: "stay",
    actor: "Healer Alpha",
    pool: "SOL/USDC",
    summary: "Held position — in range",
    reason: "PnL +12.4%, fees accruing, price within active bins",
  },
  {
    id: "dec_3",
    ts: "2026-05-24T13:48:00Z",
    type: "claim",
    actor: "Healer Alpha",
    pool: "BONK/SOL",
    summary: "Claimed accumulated fees",
    reason: "Unclaimed fees exceeded 1.2 SOL threshold",
  },
  {
    id: "dec_4",
    ts: "2026-05-24T13:20:00Z",
    type: "skip",
    actor: "Hunter Alpha",
    pool: "MEME/SOL",
    summary: "Skipped deployment",
    reason: "Holder count below minimum, rug risk flagged",
  },
  {
    id: "dec_5",
    ts: "2026-05-24T12:55:00Z",
    type: "alert",
    actor: "Healer Alpha",
    pool: "JUP/SOL",
    summary: "Position out of range",
    reason: "Price moved above upper bin — monitoring for redeploy",
  },
  {
    id: "dec_6",
    ts: "2026-05-24T12:30:00Z",
    type: "close",
    actor: "Healer Alpha",
    pool: "SAMO/USDC",
    summary: "Closed underperforming position",
    reason: "7d PnL -8.2%, fee yield below breakeven after IL",
  },
];

const days = 30;
const baseValueSol = 242;

export const portfolioHistory = Array.from({ length: days }, (_, i) => {
  const date = new Date();
  date.setDate(date.getDate() - (days - 1 - i));
  const noise = Math.sin(i / 4) * 5.4 + i * 1.45 + (Math.random() - 0.5) * 2.5;
  return {
    date: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    valueSol: Math.round((baseValueSol + noise) * 100) / 100,
  };
});

export const profitHistory = Array.from({ length: days }, (_, i) => {
  const date = new Date();
  date.setDate(date.getDate() - (days - 1 - i));
  const cumulative = i * 0.62 + Math.sin(i / 3) * 1.35 + (Math.random() - 0.3) * 0.5;
  const daily = 0.25 + Math.sin(i / 2) * 0.4 + (Math.random() - 0.5) * 0.15;
  return {
    date: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    cumulativeSol: Math.round(Math.max(0, cumulative) * 1000) / 1000,
    dailySol: Math.round(daily * 1000) / 1000,
  };
});

export function getMockDashboard() {
  return {
    source: "mock",
    solPrice: overview.solPrice,
    overview,
    positions,
    closedPositions,
    opportunities,
    decisions,
    portfolioHistory,
    profitHistory,
    agentStatus,
  };
}
