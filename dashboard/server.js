/**
 * Meridian dashboard API — live agent data in SOL denomination.
 * Run from meridian-experimental/: node dashboard/server.js
 */
import http from "http";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import dotenv from "dotenv";
import { WebSocketServer } from "ws";
import { getMockDashboard } from "./src/data/mockData.js";
import { perfFeesSol, perfPnlSol } from "../pnl-units.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

dotenv.config({ path: path.join(ROOT, ".env") });

const PORT = Number(process.env.DASHBOARD_API_PORT || 8787);

function roundSol(n, digits = 4) {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(body));
}

function usdToSol(usd, solPrice) {
  if (usd == null || !solPrice) return 0;
  return usd / solPrice;
}

function positionValueSol(p, solMode, solPrice) {
  if (solMode) return p.total_value_usd ?? 0;
  return usdToSol(p.total_value_true_usd ?? p.total_value_usd, solPrice);
}

function positionPnlSol(p, solMode, solPrice) {
  if (p.pnl_sol != null) return p.pnl_sol;
  if (solMode) return p.pnl_usd ?? 0;
  return usdToSol(p.pnl_true_usd ?? p.pnl_usd, solPrice);
}

function positionFeesSol(p, solMode, solPrice) {
  const unclaimed = solMode
    ? (p.unclaimed_fees_usd ?? 0)
    : usdToSol(p.unclaimed_fees_true_usd ?? p.unclaimed_fees_usd, solPrice);
  const collected = solMode
    ? (p.collected_fees_usd ?? 0)
    : usdToSol(p.collected_fees_true_usd ?? p.collected_fees_usd, solPrice);
  return (unclaimed || 0) + (collected || 0);
}

function importRoot(rel) {
  return import(pathToFileURL(path.join(ROOT, rel)).href);
}

function mapPerformanceToClosed(row) {
  const feesSol = perfFeesSol(row);
  const pnlSol = perfPnlSol(row);
  const finalSol = row.final_value_sol ?? row.final_value_usd ?? 0;
  const initialSol = row.initial_value_sol ?? row.initial_value_usd ?? 0;

  return {
    id: row.position || row.pool,
    position: row.position,
    pair: row.pool_name || row.pool,
    pool: row.pool,
    poolLabel: "Meteora DLMM",
    sizeSol: roundSol(finalSol ?? initialSol),
    pnlPercent: row.pnl_pct,
    pnlSol: roundSol(pnlSol),
    feesSol: roundSol(feesSol),
    status: "closed",
    binStep: row.bin_step ?? null,
    strategy: row.strategy ?? null,
    closedAt: row.recorded_at,
    closeReason: row.close_reason,
  };
}

function mapStateToClosed(tracked, solPrice, solMode) {
  const feesSol = usdToSol(tracked.total_fees_claimed_usd, solPrice);
  const initialSol = solMode
    ? tracked.initial_value_usd
    : usdToSol(tracked.initial_value_usd, solPrice);

  return {
    id: tracked.position,
    position: tracked.position,
    pair: tracked.pool_name || tracked.pool,
    pool: tracked.pool,
    poolLabel: "Meteora DLMM",
    sizeSol: roundSol(initialSol),
    pnlPercent: null,
    pnlSol: null,
    feesSol: roundSol(feesSol),
    status: "closed",
    binStep: tracked.bin_step ?? null,
    strategy: tracked.strategy ?? null,
    closedAt: tracked.closed_at,
    closeReason: tracked.notes?.length
      ? tracked.notes[tracked.notes.length - 1]
      : "Position closed",
  };
}

function buildClosedPositions({ lessonsRows, trackedClosed, solPrice, solMode, limit = 25 }) {
  const byKey = new Map();

  for (const row of lessonsRows) {
    const mapped = mapPerformanceToClosed(row);
    const key = mapped.position || `${mapped.pool}-${mapped.closedAt}`;
    byKey.set(key, mapped);
  }

  for (const tracked of trackedClosed) {
    if (!tracked.closed) continue;
    const key = tracked.position;
    if (!byKey.has(key)) {
      byKey.set(key, mapStateToClosed(tracked, solPrice, solMode));
    }
  }

  return [...byKey.values()]
    .sort((a, b) => new Date(b.closedAt || 0) - new Date(a.closedAt || 0))
    .slice(0, limit);
}

async function buildLiveDashboard() {
  const { config } = await importRoot("config.js");
  const { getWalletBalances } = await importRoot("tools/wallet.js");
  const { getMyPositions } = await importRoot("tools/dlmm.js");
  const { getStateSummary, getTrackedPositions } = await importRoot("state.js");
  const { getRecentDecisions } = await importRoot("decision-log.js");
  const { getPerformanceSummary } = await importRoot("lessons.js");
  const fs = await import("fs");

  const solMode = config.management.solMode;
  const [balance, posData, stateSummary] = await Promise.all([
    getWalletBalances(),
    getMyPositions({ force: true }),
    Promise.resolve(getStateSummary()),
  ]);

  if (balance.error && !balance.wallet) {
    throw new Error(balance.error || "Wallet not configured");
  }

  const solPrice = balance.sol_price || 150;
  const openPositions = (posData.positions || []).map((p) => ({
    id: p.position,
    position: p.position,
    pair: p.pair,
    pool: p.pool,
    poolLabel: "Meteora DLMM",
    sizeSol: roundSol(positionValueSol(p, solMode, solPrice)),
    pnlPercent: p.pnl_pct,
    pnlSol: roundSol(positionPnlSol(p, solMode, solPrice) ?? p.pnl_sol),
    feesSol: roundSol(positionFeesSol(p, solMode, solPrice)),
    status: p.in_range === false ? "out_of_range" : "in_range",
    binStep: null,
    inRange: p.in_range,
  }));

  let lessonsPerformance = [];
  const lessonsPath = path.join(ROOT, "lessons.json");
  if (fs.existsSync(lessonsPath)) {
    const lessons = JSON.parse(fs.readFileSync(lessonsPath, "utf8"));
    lessonsPerformance = lessons.performance || [];
  }

  const trackedClosed = getTrackedPositions(false).filter((p) => p.closed);
  const closedPositions = buildClosedPositions({
    lessonsRows: lessonsPerformance,
    trackedClosed,
    solPrice,
    solMode,
  });

  const lpSol = openPositions.reduce((s, p) => s + (p.sizeSol || 0), 0);
  const openPnlSol = openPositions.reduce((s, p) => s + (p.pnlSol || 0), 0);
  // open positions already in SOL when solMode (default true)
  const unclaimedSol = openPositions.reduce((s, p) => s + (p.feesSol || 0), 0);
  const claimedSol = usdToSol(stateSummary.total_fees_claimed_usd, solPrice);

  const perf = getPerformanceSummary();
  const closedPnlSol = perf ? perf.total_pnl_sol : 0;

  const overview = {
    totalBalanceSol: roundSol((balance.sol || 0) + lpSol),
    walletSol: roundSol(balance.sol),
    lpSol: roundSol(lpSol),
    balanceChange24h: null,
    pnlSol: roundSol(openPnlSol + closedPnlSol),
    pnlPercent: perf?.avg_pnl_pct ?? null,
    activePositions: openPositions.length,
    closedPositions: closedPositions.length,
    feesEarnedSol: roundSol(claimedSol + unclaimedSol),
    feesChange24hSol: null,
    solPrice: roundSol(solPrice, 2),
  };

  let profitHistory = [];
  let portfolioHistory = [];
  const perfRows = lessonsPerformance.slice(-60);
  if (perfRows.length) {
    let cum = 0;
    profitHistory = perfRows.map((row) => {
      const daily = perfFeesSol(row);
      const pnlSolRow = perfPnlSol(row);
      cum += pnlSolRow;
      const d = new Date(row.recorded_at || Date.now());
      return {
        date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        cumulativeSol: roundSol(cum),
        dailySol: roundSol(daily),
      };
    });
    let portCum = (balance.sol || 0) + lpSol;
    portfolioHistory = [...profitHistory]
      .reverse()
      .map((row, i) => {
        portCum -= (profitHistory[profitHistory.length - 1 - i]?.dailySol || 0) * 0.3;
        return { date: row.date, valueSol: roundSol(Math.max(0, portCum)) };
      })
      .reverse();
  }

  if (!portfolioHistory.length) {
    const mock = getMockDashboard();
    portfolioHistory = mock.portfolioHistory;
    profitHistory = mock.profitHistory;
  }

  portfolioHistory.push({
    date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    valueSol: overview.totalBalanceSol,
  });

  const decisions = getRecentDecisions(12).map((d) => ({
    id: d.id,
    ts: d.ts,
    type: d.type,
    actor: d.actor,
    pool: d.pool_name || d.pool,
    summary: d.summary,
    reason: d.reason,
  }));

  return {
    source: "live",
    dryRun: process.env.DRY_RUN === "true",
    solPrice: overview.solPrice,
    overview,
    positions: openPositions,
    closedPositions,
    opportunities: getMockDashboard().opportunities,
    decisions: decisions.length ? decisions : getMockDashboard().decisions,
    portfolioHistory: portfolioHistory.slice(-31),
    profitHistory: profitHistory.slice(-31),
    agentStatus: {
      running: true,
      lastCycle: stateSummary.last_updated
        ? new Date(stateSummary.last_updated).toLocaleString()
        : "—",
      agents: [
        {
          name: "Hunter Alpha",
          role: "Screening",
          interval: `${config.schedule.screeningIntervalMin}m`,
          status: "active",
        },
        {
          name: "Healer Alpha",
          role: "Management",
          interval: `${config.schedule.managementIntervalMin}m`,
          status: "active",
        },
      ],
    },
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    return json(res, 204, {});
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, 200, { ok: true, port: PORT });
    }

    if (req.method === "GET" && url.pathname === "/api/dashboard") {
      try {
        const data = await buildLiveDashboard();
        return json(res, 200, data);
      } catch (err) {
        const mock = getMockDashboard();
        return json(res, 200, {
          ...mock,
          source: "mock",
          liveError: err.message,
        });
      }
    }

    json(res, 404, { error: "Not found" });
  } catch (err) {
    json(res, 500, { error: err.message });
  }
});

// ─── WebSocket: broadcast live data on change ──────────────────────────────
const wss = new WebSocketServer({ server });
let lastHash = null;
const WS_POLL_INTERVAL = 5000;

function hashDashboard(data) {
  try {
    const key = JSON.stringify({
      sol: data.overview?.walletSol,
      pnl: data.overview?.pnlSol,
      positions: data.positions?.length,
      fees: data.overview?.feesEarnedSol,
      closed: data.closedPositions?.length,
      lastCycle: data.agentStatus?.lastCycle,
    });
    let h = 0;
    for (let i = 0; i < key.length; i++) {
      h = ((h << 5) - h + key.charCodeAt(i)) | 0;
    }
    return h;
  } catch { return 0; }
}

async function pollAndBroadcast() {
  try {
    const data = await buildLiveDashboard();
    const h = hashDashboard(data);
    if (h !== lastHash) {
      lastHash = h;
      const payload = JSON.stringify({ type: "update", data });
      for (const client of wss.clients) {
        if (client.readyState === 1) client.send(payload);
      }
    }
  } catch { /* ignore poll errors */ }
}

wss.on("connection", async (ws) => {
  console.log(`[WS] client connected (total: ${wss.clients.size})`);
  // Send initial snapshot immediately
  try {
    const data = await buildLiveDashboard();
    ws.send(JSON.stringify({ type: "update", data }));
  } catch { /* ignore */ }
  ws.on("close", () => console.log(`[WS] client disconnected (total: ${wss.clients.size})`));
});

setInterval(pollAndBroadcast, WS_POLL_INTERVAL);

server.listen(PORT, () => {
  console.log(`Meridian dashboard API http://localhost:${PORT}`);
  console.log(`  GET /api/dashboard`);
  console.log(`  WS  ws://localhost:${PORT} (poll every ${WS_POLL_INTERVAL / 1000}s)`);
});
