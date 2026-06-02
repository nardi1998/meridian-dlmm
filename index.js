import "./envcrypt.js";
import cron from "node-cron";
import readline from "readline";
import path from "path";
import { fileURLToPath } from "url";
import { agentLoop } from "./agent.js";
import { log } from "./logger.js";
import { getMyPositions, closePosition, getActiveBin } from "./tools/dlmm.js";
import { getWalletBalances, normalizeMint, swapToken } from "./tools/wallet.js";
import { getTopCandidates } from "./tools/screening.js";
import { formatGmgnCandidateForPrompt } from "./tools/gmgn.js";
import { config, reloadScreeningThresholds, computeDeployAmount } from "./config.js";
import { evolveThresholds, getPerformanceSummary } from "./lessons.js";
import { executeTool, registerCronRestarter } from "./tools/executor.js";
import {
  startPolling,
  stopPolling,
  sendMessage,
  sendMessageWithButtons,
  sendHTML,
  editMessage,
  editMessageWithButtons,
  answerCallbackQuery,
  notifyOutOfRange,
  isEnabled as telegramEnabled,
  createLiveMessage,
} from "./telegram.js";
import { generateBriefing } from "./briefing.js";
import { getLastBriefingDate, setLastBriefingDate, getTrackedPosition, getTrackedPositions, setPositionInstruction, updatePnlAndCheckExits, queuePeakConfirmation, resolvePendingPeak, queueTrailingDropConfirmation, resolvePendingTrailingDrop } from "./state.js";
import { getActiveStrategy } from "./strategy-library.js";
import { recordPositionSnapshot, recallForPool, addPoolNote } from "./pool-memory.js";
import { checkSmartWalletsOnPool } from "./smart-wallets.js";
import { getTokenNarrative, getTokenInfo, getMeteoraTokenInfo } from "./tools/token.js";
import { stageSignals } from "./signal-tracker.js";
import { getWeightsSummary } from "./signal-weights.js";
import { bootstrapHiveMind, ensureAgentId, getHiveMindPullMode, isHiveMindEnabled, pullHiveMindLessons, pullHiveMindPresets, registerHiveMindAgent, startHiveMindBackgroundSync } from "./hivemind.js";
import { appendDecision } from "./decision-log.js";

const entrypointPath = process.env.pm_exec_path || process.argv[1];
const isMain = entrypointPath
  ? path.resolve(entrypointPath) === fileURLToPath(import.meta.url)
  : false;

if (isMain) {
  log("startup", "DLMM LP Agent starting...");
  log("startup", `Mode: ${process.env.DRY_RUN === "true" ? "DRY RUN" : "LIVE"}`);
  log("startup", `Model: ${process.env.LLM_MODEL || "hermes-3-405b"}`);
  ensureAgentId();
  bootstrapHiveMind().catch((error) => log("hivemind_warn", `Bootstrap failed: ${error.message}`));
  startHiveMindBackgroundSync();
}

const TP_PCT = config.management.takeProfitPct;
const DEPLOY = config.management.deployAmountSol;

const SWAP_DUST_THRESHOLD = 0.0001;
const WHALE_ESCAPE_NAME = "Whale Escape";
const whaleEscapeTokenCache = new Map();

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const n = toFiniteNumber(value);
    if (n != null) return n;
  }
  return null;
}

function getWhaleEscapeBottomDistance(position) {
  const activeBin = toFiniteNumber(position?.active_bin);
  const lowerBin = toFiniteNumber(position?.lower_bin);
  if (activeBin == null || lowerBin == null) return null;
  return activeBin - lowerBin;
}

function formatWhaleEscapeConfigSummary(managementConfig) {
  const warnTvlPct = Math.max(0, Number(managementConfig.whaleEscapeWarnTvlPct ?? 8));
  const closeTvlPct = Math.max(0, Number(managementConfig.whaleEscapeCloseTvlPct ?? 15));
  const absFloorUsd = Math.max(0, Number(managementConfig.whaleEscapeAbsFloorUsd ?? 10000));
  const legacyAbsFloorUsd = Math.max(0, Number(managementConfig.whaleEscapeLegacyAbsFloorUsd ?? 5000));
  const cacheSec = Math.max(1, Number(managementConfig.whaleEscapeNetDepCacheSec ?? 30));
  return `tvlPct ${closeTvlPct}% (warn ${warnTvlPct}%) | absFloor $-${absFloorUsd.toFixed(0)} | legacyAbs $-${legacyAbsFloorUsd.toFixed(0)} | netDepCache ${cacheSec}s`;
}

async function fetchWhaleEscapeTokenInfo(mint, managementConfig) {
  const apiSource = String(managementConfig.whaleEscapeApi || "datapi").toLowerCase();
  const cacheKey = `${apiSource}:${mint}`;
  const cacheTtlMs = Math.max(1, Number(managementConfig.whaleEscapeNetDepCacheSec ?? 30)) * 1000;
  const cached = whaleEscapeTokenCache.get(cacheKey);
  if (cached && (Date.now() - cached.at) < cacheTtlMs) return cached.info;

  const info = apiSource === "meteora"
    ? await getMeteoraTokenInfo({ query: mint })
    : await getTokenInfo({ query: mint });

  whaleEscapeTokenCache.set(cacheKey, { at: Date.now(), info });
  return info;
}

function extractWhaleEscapeNetDep(token) {
  const liquidityUsd = toFiniteNumber(token?.liquidity);
  const stats = token?.stats_1h || {};
  const pool = token?.pool || {};

  const liquidityChangePct = firstFiniteNumber(
    stats.liquidity_change,
    stats.liquidityChange,
    token?.liquidity_change_pct,
    token?.tvl_change_pct,
    token?.tvlChangePct,
    pool?.liquidity_change_pct,
    pool?.liquidityChangePct,
    pool?.tvl_change_pct,
    pool?.tvlChangePct,
    pool?.tvl_change_1h_pct,
    pool?.tvlChange1hPct,
    pool?.stats?.["1h"]?.liquidity_change,
    pool?.stats?.["1h"]?.tvl_change_pct,
    pool?.stats?.liquidity_change,
    pool?.stats?.tvl_change_pct,
  );

  const directUsd = firstFiniteNumber(
    token?.net_dep_usd,
    token?.netDepUsd,
    token?.net_deposit_usd,
    token?.netDepositUsd,
    token?.stats_1h?.net_dep_usd,
    token?.stats_1h?.netDepUsd,
    pool?.net_dep_usd,
    pool?.netDepUsd,
    pool?.stats?.["1h"]?.net_dep_usd,
    pool?.stats?.["1h"]?.netDepUsd,
  );

  const netDepUsd = directUsd != null
    ? directUsd
    : liquidityUsd != null && liquidityChangePct != null
      ? (liquidityUsd * liquidityChangePct) / 100
      : null;

  const netDepPct = netDepUsd != null && liquidityUsd != null && liquidityUsd > 0
    ? (netDepUsd / liquidityUsd) * 100
    : liquidityChangePct;

  return { liquidityUsd, liquidityChangePct, netDepUsd, netDepPct };
}

async function getWhaleEscapeSignal(position, managementConfig) {
  if (!position.base_mint || !managementConfig.whaleEscapeEnabled) return null;
  const mint = position.base_mint;
  if (/^So11111111111111111111111111111111111111112$/i.test(mint) || /^SOL$/i.test(mint)) return null;

  try {
    const info = await fetchWhaleEscapeTokenInfo(mint, managementConfig);
    if (!info?.found || !Array.isArray(info.results) || info.results.length === 0) return null;

    const token = info.results[0];
    const { liquidityUsd, netDepUsd, netDepPct } = extractWhaleEscapeNetDep(token);
    if (netDepUsd == null || netDepPct == null || liquidityUsd == null || liquidityUsd <= 0) return null;

    const absFloorUsd = Math.max(0, Number(managementConfig.whaleEscapeAbsFloorUsd ?? 10000));
    const legacyAbsFloorUsd = Math.max(0, Number(managementConfig.whaleEscapeLegacyAbsFloorUsd ?? 5000));
    const warnTvlPct = Math.max(0, Number(managementConfig.whaleEscapeWarnTvlPct ?? 8));
    const closeTvlPct = Math.max(0, Number(managementConfig.whaleEscapeCloseTvlPct ?? 15));
    const bottomBinDistanceLimit = Math.max(0, Number(managementConfig.whaleEscapeBottomBinDistance ?? 3));
    const bottomDistance = getWhaleEscapeBottomDistance(position);
    const nearBottomBin = bottomDistance != null && Math.abs(bottomDistance) <= bottomBinDistanceLimit;

    const closeByPct = netDepPct <= -closeTvlPct;
    const warnByPct = netDepPct <= -warnTvlPct;
    const closeByAbs = netDepUsd <= -absFloorUsd;
    const warnByAbs = netDepUsd <= -legacyAbsFloorUsd;
    const closeSignal = (closeByPct || closeByAbs) && nearBottomBin;
    const warnSignal = !closeSignal && (warnByPct || warnByAbs);

    if (!closeSignal && !warnSignal) return null;

    const reason = WHALE_ESCAPE_NAME + ": Net Dep " + netDepUsd.toFixed(0) + " USD (" + netDepPct.toFixed(1) + "% of TVL ($" + liquidityUsd.toFixed(0) + "))" + (nearBottomBin ? " & Price near bottom bin (dist: " + bottomDistance + ")" : "");
    return {
      severity: closeSignal ? "close" : "warn",
      reason,
      netDepUsd,
      netDepPct,
      liquidityUsd,
      bottomDistance,
    };
  } catch (error) {
    log("whale_activity", "Token info failed for " + (position.pair || position.pool) + ": " + error.message);
    return null;
  }
}

function buildGmgnFunnelReport(stageCounts, allFiltered = [], { fromStage = 1 } = {}) {
  if (!stageCounts) return null;
  const sc = stageCounts;
  const funnel = `GMGN funnel: ranked=${sc.ranked ?? "?"} → S1=${sc.s1 ?? "?"} → S2=${sc.s2 ?? "?"} → S3=${sc.s3 ?? "?"} → S4=${sc.s4 ?? "?"} → final=${sc.s5 ?? "?"}`;
  const byStage = {};
  for (const f of allFiltered) {
    if (f.stage < fromStage) continue;
    const key = `s${f.stage}`;
    if (!byStage[key]) byStage[key] = [];
    byStage[key].push(`${f.name}: ${f.reason}`);
  }
  const stageLabels = { s2: "S2 info", s3: "S3 pool", s4: "S4 indicators", s5: "S5 pick" };
  const details = Object.entries(byStage)
    .map(([key, items]) => `${stageLabels[key] || key}:\n${items.map(r => `  • ${r}`).join("\n")}`)
    .join("\n");
  return details ? `${funnel}\n\n${details}` : funnel;
}

function getLoneCandidateSkipReason({ pool, sw, n, ti } = {}) {
  if (!pool) return "missing candidate data";
  const smartWalletCount = Math.max(sw?.in_pool?.length ?? 0, Number(pool.gmgn_smart_wallets ?? 0) || 0);
  const tokenInfo = ti || {};
  const hasNarrative = !!n?.narrative;
  const globalFeesSol = Number(tokenInfo.global_fees_sol ?? pool.gmgn_total_fee_sol);
  const top10Pct = Number(tokenInfo.audit?.top_holders_pct ?? pool.gmgn_token_info_top10_pct ?? pool.gmgn_top10_holder_pct);
  const botPct = Number(tokenInfo.audit?.bot_holders_pct ?? pool.gmgn_bot_degen_pct);
  if (pool.is_wash) return "wash trading was flagged";
  if (pool.is_rugpull && smartWalletCount === 0) return "rugpull risk was flagged and no smart wallets offset it";
  if (pool.is_pvp && smartWalletCount === 0) return "PVP symbol conflict and no smart-wallet confirmation";
  if (Number.isFinite(globalFeesSol) && globalFeesSol < config.screening.minTokenFeesSol) {
    return `token fees ${globalFeesSol} SOL below minimum ${config.screening.minTokenFeesSol} SOL`;
  }
  if (Number.isFinite(top10Pct) && top10Pct > config.screening.maxTop10Pct) {
    return `top10 concentration ${top10Pct}% above maximum ${config.screening.maxTop10Pct}%`;
  }
  if (Number.isFinite(botPct) && botPct > config.screening.maxBotHoldersPct) {
    return `bot holders ${botPct}% above maximum ${config.screening.maxBotHoldersPct}%`;
  }
  if (!hasNarrative && smartWalletCount === 0) return "only candidate has no narrative and no smart-wallet confirmation";
  return null;
}

function computeBinsBelow(volatility) {
  if (config.strategy.fixedBinsBelowEnabled) {
    return config.strategy.fixedBinsBelow;
  }
  const parsedVolatility = Number(volatility);
  if (!Number.isFinite(parsedVolatility) || parsedVolatility <= 0) {
    throw new Error(`Invalid volatility ${volatility ?? "unknown"} — refusing volatility-scaled deploy.`);
  }
  const lo = config.strategy.minBinsBelow;
  const hi = config.strategy.maxBinsBelow;
  return Math.max(lo, Math.min(hi, Math.round(lo + (parsedVolatility / 5) * (hi - lo))));
}

// ═══════════════════════════════════════════
//  INTERACTIVE REPL
// ═══════════════════════════════════════════
const isTTY = process.stdin.isTTY;
let cronStarted = false;
let busy = false;
const _telegramQueue = []; // queued messages received while agent was busy
const sessionHistory = []; // persists conversation across REPL turns
const MAX_HISTORY = 20;    // keep last 20 messages (10 exchanges)
let _ttyInterface = null;
let _latestCandidates = [];
let _latestCandidatesAt = null;
let _pendingInput = null; // { key, page, menuMsgId }
const timers = {
  managementLastRun: null,
  screeningLastRun: null,
  whaleActivityLastRun: null,
};
let _managementBusy = false;
let _screeningBusy = false;
let _whaleActivityBusy = false;
let _cronTasks = [];

function nextRunIn(lastRun, intervalMin) {
  if (!lastRun) return intervalMin * 60;
  const elapsed = (Date.now() - lastRun) / 1000;
  return Math.max(0, intervalMin * 60 - elapsed);
}

function formatCountdown(seconds) {
  if (seconds <= 0) return "now";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function buildPrompt() {
  const mgmt = formatCountdown(nextRunIn(timers.managementLastRun, config.schedule.managementIntervalMin));
  const scrn = formatCountdown(nextRunIn(timers.screeningLastRun, config.schedule.screeningIntervalMin));
  const whale = formatCountdown(nextRunIn(timers.whaleActivityLastRun, config.schedule.whaleActivityIntervalMin));
  return `[manage: ${mgmt} | screen: ${scrn} | whale: ${whale}]\n> `;
}

function setLatestCandidates(candidates = []) {
  _latestCandidates = Array.isArray(candidates) ? candidates : [];
  _latestCandidatesAt = new Date().toISOString();
}

function getLatestCandidatesMeta() {
  return {
    candidates: _latestCandidates,
    count: _latestCandidates.length,
    updatedAt: _latestCandidatesAt,
  };
}

function describeLatestCandidates(limit = 5) {
  if (!_latestCandidates.length) return "No cached candidates yet. Run /screen first.";
  const lines = _latestCandidates.slice(0, limit).map((pool, i) => {
    const feeTvl = pool.fee_active_tvl_ratio ?? pool.fee_tvl_ratio ?? "?";
    const vol = pool.volume_window ?? pool.volume_24h ?? "?";
    const active = pool.active_pct ?? "?";
    const organic = pool.organic_score ?? "?";
    return `${i + 1}. ${pool.name} | fee/aTVL ${feeTvl}% | vol $${vol} | in-range ${active}% | organic ${organic}`;
  });
  const age = _latestCandidatesAt ? new Date(_latestCandidatesAt).toLocaleString("en-US", { hour12: false }) : "unknown";
  return `Latest candidates (${_latestCandidates.length}) — updated ${age}\n\n${lines.join("\n")}`;
}

function formatCandidates(candidates) {
  if (!Array.isArray(candidates) || !candidates.length) return "  (none)";
  return candidates.map((pool, i) => {
    const feeTvl = pool.fee_active_tvl_ratio ?? pool.fee_tvl_ratio ?? "?";
    const vol = pool.volume_window ?? pool.volume_24h ?? "?";
    const tvl = pool.tvl ?? pool.active_tvl ?? "?";
    const organic = pool.organic_score ?? "?";
    const holders = pool.holders ?? "?";
    return `  ${i + 1}. ${pool.name} | fee/aTVL ${feeTvl}% | vol $${vol} | TVL $${tvl} | holders ${holders} | organic ${organic}`;
  }).join("\n");
}

async function maybeRunMissedBriefing() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const lastBriefing = getLastBriefingDate();
    if (lastBriefing === today) return;
    if (!telegramEnabled()) return;
    const briefing = await generateBriefing();
    const text = briefing.replace(/<[^>]*>/g, "");
    await sendMessage(`Morning briefing (auto):\n\n${text}`).catch(() => {});
    setLastBriefingDate();
    log("briefing", "Sent missed briefing for " + today);
  } catch (error) {
    log("briefing_warn", "maybeRunMissedBriefing failed: " + error.message);
  }
}

function formatWalletStatus(wallet, positions) {
  const deployAmount = computeDeployAmount(wallet.sol);
  const hive = isHiveMindEnabled() ? "on" : "off";
  return [
    `Wallet: ${wallet.sol} SOL ($${wallet.sol_usd})`,
    `SOL price: $${wallet.sol_price}`,
    `Open positions: ${positions.total_positions}/${config.risk.maxPositions}`,
    `Next deploy amount: ${deployAmount} SOL`,
    `Dry run: ${process.env.DRY_RUN === "true" ? "yes" : "no"}`,
    `HiveMind: ${hive}`,
  ].join("\n");
}

function formatConfigSnapshot() {
  return [
    "Config snapshot",
    "",
    `Screening source: ${config.screening.source}`,
    `Strategy: ${config.strategy.strategy} | bins: [${config.strategy.minBinsBelow}–${config.strategy.maxBinsBelow}] (volatility-scaled)`,
    `Deploy: ${config.management.deployAmountSol} SOL | gasReserve: ${config.management.gasReserve} | maxPositions: ${config.risk.maxPositions}`,
    `Stop loss: ${config.management.stopLossPct}% | take profit: ${config.management.takeProfitPct}%`,
    `Trailing: ${config.management.trailingTakeProfit ? "on" : "off"} | trigger ${config.management.trailingTriggerPct}% | drop ${config.management.trailingDropPct}%`,
    `OOR: ${config.management.outOfRangeWaitMinutes}m | cooldown ${config.management.oorCooldownTriggerCount}x / ${config.management.oorCooldownHours}h`,
    `Repeat deploy cooldown: ${config.management.repeatDeployCooldownEnabled ? "on" : "off"} | ${config.management.repeatDeployCooldownTriggerCount}x / ${config.management.repeatDeployCooldownHours}h | min fee earned ${config.management.repeatDeployCooldownMinFeeEarnedPct}% | ${config.management.repeatDeployCooldownScope}`,
    `Yield floor: ${config.management.minFeePerTvl24h}% | min age ${config.management.minAgeBeforeYieldCheck}m`,
    `Screening: ${config.screening.category} / ${config.screening.timeframe} | TVL ${config.screening.minTvl}-${config.screening.maxTvl}`,
    `GMGN interval: ${config.gmgn.interval} | OrderBy: ${config.gmgn.orderBy} | Dir: ${config.gmgn.direction}`,
    `Intervals: manage ${config.schedule.managementIntervalMin}m | screen ${config.schedule.screeningIntervalMin}m`,
    `HiveMind: ${isHiveMindEnabled() ? "enabled" : "disabled"}${config.hiveMind.agentId ? ` | ${config.hiveMind.agentId}` : ""}`,
  ].join("\n");
}

function parseConfigValue(raw) {
  const value = String(raw ?? "").trim();
  if (!value.length) return "";
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === "true";
  if (/^null$/i.test(value)) return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith("[") && value.endsWith("]")) || (value.startsWith("{") && value.endsWith("}"))) {
    return JSON.parse(value);
  }
  return value;
}

function settingValue(key) {
  const values = {
    solMode: config.management.solMode,
    lpAgentRelayEnabled: config.api.lpAgentRelayEnabled,
    chartIndicatorsEnabled: config.indicators.enabled,
    trailingTakeProfit: config.management.trailingTakeProfit,
    useDiscordSignals: config.screening.useDiscordSignals,
    blockPvpSymbols: config.screening.blockPvpSymbols,
    screeningSource: config.screening.source,
    gmgnRequireKol: config.gmgn.requireKol,
    gmgnInterval: config.gmgn.interval,
    gmgnIndicatorFilter: config.gmgn.indicatorFilter,
    gmgnMinVolume: config.gmgn.minVolume,
    gmgnMinTokenAgeHours: config.gmgn.minTokenAgeHours,
    gmgnMaxTokenAgeHours: config.gmgn.maxTokenAgeHours,
    gmgnMaxBundlerRate: config.gmgn.maxBundlerRate,
    gmgnPreferredKolNames: config.gmgn.preferredKolNames,
    gmgnPreferredKolMinHoldPct: config.gmgn.preferredKolMinHoldPct,
    gmgnDumpKolNames: config.gmgn.dumpKolNames,
    gmgnDumpKolMinHoldPct: config.gmgn.dumpKolMinHoldPct,
    gmgnIndicatorInterval: config.gmgn.indicatorInterval,
    gmgnRequireBullishSt: config.gmgn.indicatorRules?.requireBullishSupertrend,
    gmgnRejectAtBottom: config.gmgn.indicatorRules?.rejectAlreadyAtBottom,
    gmgnRequireAboveSt: config.gmgn.indicatorRules?.requireAboveSupertrend,
    gmgnMinRsi: config.gmgn.indicatorRules?.minRsi,
    gmgnMaxRsi: config.gmgn.indicatorRules?.maxRsi,
    gmgnMinKolCount: config.gmgn.minKolCount,
    gmgnMinTotalFeeSol: config.gmgn.minTotalFeeSol,
    gmgnMinHolders: config.gmgn.minHolders,
    strategy: config.strategy.strategy,
    minBinsBelow: config.strategy.minBinsBelow,
    maxBinsBelow: config.strategy.maxBinsBelow,
    deployAmountSol: config.management.deployAmountSol,
    gasReserve: config.management.gasReserve,
    maxPositions: config.risk.maxPositions,
    maxDeployAmount: config.risk.maxDeployAmount,
    takeProfitPct: config.management.takeProfitPct,
    stopLossPct: config.management.stopLossPct,
    trailingTriggerPct: config.management.trailingTriggerPct,
    trailingDropPct: config.management.trailingDropPct,
    repeatDeployCooldownEnabled: config.management.repeatDeployCooldownEnabled,
    repeatDeployCooldownTriggerCount: config.management.repeatDeployCooldownTriggerCount,
    repeatDeployCooldownHours: config.management.repeatDeployCooldownHours,
    repeatDeployCooldownMinFeeEarnedPct: config.management.repeatDeployCooldownMinFeeEarnedPct,
    managementIntervalMin: config.schedule.managementIntervalMin,
    screeningIntervalMin: config.schedule.screeningIntervalMin,
    indicatorEntryPreset: config.indicators.entryPreset,
    indicatorExitPreset: config.indicators.exitPreset,
    rsiLength: config.indicators.rsiLength,
    indicatorIntervals: config.indicators.intervals,
    requireAllIntervals: config.indicators.requireAllIntervals,
  };
  return values[key];
}

function fmtSettingValue(value) {
  if (Array.isArray(value)) return value.join(",");
  if (typeof value === "boolean") return value ? "on" : "off";
  return String(value);
}

function settingButton(label, data) {
  return { text: label, callback_data: data };
}

function toggleButton(key, label) {
  return settingButton(`${label}: ${fmtSettingValue(settingValue(key))}`, `cfg:toggle:${key}`);
}

function stepButtons(key, label, step, { digits = 2 } = {}) {
  const value = Number(settingValue(key));
  const shown = Number.isFinite(value) ? value.toFixed(digits).replace(/\.?0+$/, "") : "?";
  return [
    settingButton(`- ${label}`, `cfg:step:${key}:${-step}`),
    settingButton(`${label}: ${shown}`, `cfg:noop`),
    settingButton(`+ ${label}`, `cfg:step:${key}:${step}`),
  ];
}

function inputButton(key, label, { digits = 0 } = {}) {
  const value = settingValue(key);
  const shown = value == null ? "off" : Number.isFinite(Number(value)) ? String(parseFloat(Number(value).toFixed(digits))) : String(value);
  return [settingButton(`${label}: ${shown} ✏`, `cfg:input:${key}`)];
}

function renderSettingsMenu(page = "main") {
  const title = page === "main" ? "Settings menu" : `Settings: ${page}`;
  const summary = [
    title,
    "",
    `Mode: ${config.management.solMode ? "SOL" : "USD"} | Relay: ${config.api.lpAgentRelayEnabled ? "on" : "off"}`,
    `Screening: ${config.screening.source} | GMGN KOL ${config.gmgn.requireKol ? "required" : "preferred"}`,
    `Strategy: ${config.strategy.strategy} | deploy ${config.management.deployAmountSol} SOL | max pos ${config.risk.maxPositions}`,
    `TP/SL: ${config.management.takeProfitPct}% / ${config.management.stopLossPct}% | trailing ${config.management.trailingTakeProfit ? "on" : "off"}`,
    `Indicators: ${config.indicators.enabled ? "on" : "off"} | entry ${config.indicators.entryPreset} | ${fmtSettingValue(config.indicators.intervals)}`,
  ].join("\n");

  const nav = [
    [
      settingButton("Main", "cfg:page:main"),
      settingButton("Risk", "cfg:page:risk"),
      settingButton("Strategy", "cfg:page:strategy"),
    ],
    [
      settingButton("Screen", "cfg:page:screen"),
      settingButton("Indicators", "cfg:page:indicators"),
      settingButton("GMGN", "cfg:page:gmgn"),
      settingButton("KOL", "cfg:page:kol"),
    ],
  ];

  const footer = [
    [
      settingButton("Refresh", `cfg:page:${page}`),
      settingButton("Close", "cfg:close"),
    ],
  ];

  let rows;
  if (page === "risk") {
    rows = [
      inputButton("deployAmountSol", "Deploy SOL", { digits: 2 }),
      inputButton("gasReserve", "Gas reserve", { digits: 2 }),
      inputButton("maxPositions", "Max positions"),
      inputButton("maxDeployAmount", "Max SOL"),
      inputButton("takeProfitPct", "TP %"),
      inputButton("stopLossPct", "SL %"),
      [toggleButton("trailingTakeProfit", "Trailing TP")],
      inputButton("trailingTriggerPct", "Trail trigger", { digits: 1 }),
      inputButton("trailingDropPct", "Trail drop", { digits: 1 }),
      [toggleButton("repeatDeployCooldownEnabled", "Repeat cooldown")],
      inputButton("repeatDeployCooldownTriggerCount", "Repeat count"),
      inputButton("repeatDeployCooldownHours", "Repeat hrs"),
      inputButton("repeatDeployCooldownMinFeeEarnedPct", "Min fee earned %", { digits: 1 }),
    ];
  } else if (page === "screen") {
    rows = [
      [
        settingButton("Source: Meteora", "cfg:set:screeningSource:meteora"),
        settingButton("Source: GMGN", "cfg:set:screeningSource:gmgn"),
      ],
      [toggleButton("gmgnRequireKol", "GMGN require KOL")],
      [toggleButton("useDiscordSignals", "Discord signals"), toggleButton("blockPvpSymbols", "PVP hard block")],
      [
        settingButton("5m", "cfg:set:gmgnInterval:5m"),
        settingButton("1h", "cfg:set:gmgnInterval:1h"),
        settingButton("6h", "cfg:set:gmgnInterval:6h"),
        settingButton("24h", "cfg:set:gmgnInterval:24h"),
      ],
      [
        inputButton("gmgnMinVolume", "Min volume")[0],
        inputButton("gmgnMinTokenAgeHours", "Min token age (h)")[0],
      ],
      [
        inputButton("gmgnMaxTokenAgeHours", "Max token age (h)")[0],
        inputButton("gmgnMaxBundlerRate", "Max bundler %")[0],
      ],
      [settingButton("KOL settings", "cfg:page:kol")],
      inputButton("managementIntervalMin", "Manage interval (min)"),
      inputButton("screeningIntervalMin", "Screen interval (min)"),
    ];
  } else if (page === "strategy") {
    rows = [
      [
        settingButton("spot", "cfg:set:strategy:spot"),
        settingButton("bid_ask", "cfg:set:strategy:bid_ask"),
      ],
      inputButton("minBinsBelow", "Min bins"),
      inputButton("maxBinsBelow", "Max bins"),
    ];
  } else if (page === "gmgn") {
    rows = [
      [toggleButton("gmgnIndicatorFilter", "Indicator filter"), toggleButton("gmgnRequireKol", "Require KOL")],
      [
        settingButton("TF: 5m", "cfg:set:gmgnIndicatorInterval:5_MINUTE"),
        settingButton("TF: 15m", "cfg:set:gmgnIndicatorInterval:15_MINUTE"),
        settingButton("TF: 1h", "cfg:set:gmgnIndicatorInterval:1h"),
      ],
      [toggleButton("gmgnRequireBullishSt", "Bullish ST"), toggleButton("gmgnRejectAtBottom", "Reject at bottom"), toggleButton("gmgnRequireAboveSt", "Above ST")],
      inputButton("gmgnMinRsi", "Min RSI"),
      inputButton("gmgnMaxRsi", "Max RSI"),
      inputButton("gmgnMinKolCount", "Min KOL"),
      inputButton("gmgnMinTotalFeeSol", "Min fee SOL"),
      inputButton("gmgnMinHolders", "Min holders"),
      [settingButton("KOL settings", "cfg:page:kol")],
    ];
  } else if (page === "kol") {
    rows = [
      inputButton("gmgnPreferredKolNames", "Preferred KOL (comma-sep)"),
      inputButton("gmgnPreferredKolMinHoldPct", "Preferred KOL min hold %"),
      inputButton("gmgnDumpKolNames", "Dump KOL (comma-sep)"),
      inputButton("gmgnDumpKolMinHoldPct", "Dump KOL min hold %"),
    ];
  } else if (page === "indicators") {
    rows = [
      [toggleButton("chartIndicatorsEnabled", "Chart indicators"), toggleButton("requireAllIntervals", "Require all TF")],
      [
        settingButton("TF: 5m", "cfg:set:indicatorIntervals:5_MINUTE"),
        settingButton("TF: 15m", "cfg:set:indicatorIntervals:15_MINUTE"),
        settingButton("TF: both", "cfg:set:indicatorIntervals:both"),
      ],
      [
        settingButton("Entry: ST", "cfg:set:indicatorEntryPreset:supertrend_break"),
        settingButton("Entry: RSI", "cfg:set:indicatorEntryPreset:rsi_reversal"),
        settingButton("Entry: ST/RSI", "cfg:set:indicatorEntryPreset:supertrend_or_rsi"),
      ],
      [
        settingButton("Exit: ST", "cfg:set:indicatorExitPreset:supertrend_break"),
        settingButton("Exit: RSI", "cfg:set:indicatorExitPreset:rsi_reversal"),
        settingButton("Exit: BB+RSI", "cfg:set:indicatorExitPreset:bb_plus_rsi"),
      ],
      inputButton("rsiLength", "RSI length"),
    ];
  } else {
    rows = [
      [
        settingButton("Source: Meteora", "cfg:set:screeningSource:meteora"),
        settingButton("Source: GMGN", "cfg:set:screeningSource:gmgn"),
      ],
      [toggleButton("solMode", "SOL mode"), toggleButton("lpAgentRelayEnabled", "LPAgent relay")],
      [toggleButton("chartIndicatorsEnabled", "Chart indicators"), toggleButton("trailingTakeProfit", "Trailing TP")],
      [
        settingButton("Risk / deploy", "cfg:page:risk"),
        settingButton("Screening", "cfg:page:screen"),
      ],
      [
        settingButton("Indicators", "cfg:page:indicators"),
        settingButton("Show config", "cfg:show"),
      ],
    ];
  }

  return { text: summary, keyboard: [...nav, ...rows, ...footer] };
}

async function showSettingsMenu({ messageId = null, page = "main" } = {}) {
  const menu = renderSettingsMenu(page);
  if (messageId) {
    await editMessageWithButtons(menu.text, messageId, menu.keyboard);
  } else {
    await sendMessageWithButtons(menu.text, menu.keyboard);
  }
}

function normalizeMenuValue(key, raw) {
  if (key === "indicatorIntervals") {
    if (raw === "both") return ["5_MINUTE", "15_MINUTE"];
    return [raw];
  }
  if (key === "gmgnPreferredKolNames" || key === "gmgnDumpKolNames") {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return parseConfigValue(raw);
}

async function applySettingsMenuCallback(msg) {
  const data = msg.callbackData || msg.text || "";
  const parts = data.split(":");
  const action = parts[1];
  let page = "main";

  if (action === "noop") {
    await answerCallbackQuery(msg.callbackQueryId);
    return;
  }
  if (action === "input") {
    const inputKey = parts[2];
    const currentVal = settingValue(inputKey);
    const inputPage = ["gmgnPreferredKolNames", "gmgnPreferredKolMinHoldPct", "gmgnDumpKolNames", "gmgnDumpKolMinHoldPct"].includes(inputKey) ? "kol"
      : ["gmgnMinVolume", "gmgnMaxBundlerRate", "gmgnMinTokenAgeHours", "gmgnMaxTokenAgeHours"].includes(inputKey) ? "screen"
      : inputKey.startsWith("gmgn") && inputKey !== "gmgnRequireKol" ? "gmgn"
      : inputKey.startsWith("indicator") || inputKey === "chartIndicatorsEnabled" || inputKey === "rsiLength" || inputKey === "requireAllIntervals" ? "indicators"
      : ["minBinsBelow", "maxBinsBelow"].includes(inputKey) ? "strategy"
      : ["useDiscordSignals", "blockPvpSymbols", "managementIntervalMin", "screeningIntervalMin", "screeningSource", "gmgnRequireKol"].includes(inputKey) ? "screen"
      : "risk";
    _pendingInput = { key: inputKey, page: inputPage, menuMsgId: msg.messageId };
    await answerCallbackQuery(msg.callbackQueryId);
    await sendMessage(`Enter new value for ${inputKey} (current: ${currentVal ?? "off"}):\nSend a number, or "off" to clear.`);
    return;
  }
  if (action === "close") {
    await answerCallbackQuery(msg.callbackQueryId, "Closed");
    await editMessage("Settings menu closed.", msg.messageId);
    return;
  }
  if (action === "show") {
    await answerCallbackQuery(msg.callbackQueryId);
    await editMessageWithButtons(formatConfigSnapshot(), msg.messageId, [[settingButton("Back", "cfg:page:main")]]);
    return;
  }
  if (action === "page") {
    page = parts[2] || "main";
    await answerCallbackQuery(msg.callbackQueryId);
    await showSettingsMenu({ messageId: msg.messageId, page });
    return;
  }

  const key = parts[2];
  let value;
  if (action === "toggle") {
    value = !Boolean(settingValue(key));
  } else if (action === "step") {
    const current = Number(settingValue(key));
    const delta = Number(parts[3]);
    if (!Number.isFinite(current) || !Number.isFinite(delta)) {
      await answerCallbackQuery(msg.callbackQueryId, "Invalid setting");
      return;
    }
    value = Number((current + delta).toFixed(4));
    if (key === "maxPositions") value = Math.max(1, Math.round(value));
    if (key === "rsiLength") value = Math.max(2, Math.round(value));
    if (key === "repeatDeployCooldownTriggerCount") value = Math.max(1, Math.round(value));
    if (key === "repeatDeployCooldownHours") value = Math.max(0, Math.round(value));
    if (key === "repeatDeployCooldownMinFeeEarnedPct") value = Math.max(0, value);
    if (["deployAmountSol", "gasReserve", "maxDeployAmount"].includes(key)) value = Math.max(0, value);
  } else if (action === "set") {
    value = normalizeMenuValue(key, parts.slice(3).join(":"));
  } else {
    await answerCallbackQuery(msg.callbackQueryId, "Unknown action");
    return;
  }

  const result = await executeTool("update_config", {
    changes: { [key]: value },
    reason: "Telegram settings menu",
  });
  if (!result?.success) {
    await answerCallbackQuery(msg.callbackQueryId, "Config update failed");
    return;
  }
  page = ["gmgnPreferredKolNames", "gmgnPreferredKolMinHoldPct", "gmgnDumpKolNames", "gmgnDumpKolMinHoldPct"].includes(key) ? "kol"
    : ["gmgnMinVolume", "gmgnMaxBundlerRate", "gmgnMinTokenAgeHours", "gmgnMaxTokenAgeHours"].includes(key) ? "screen"
    : key.startsWith("gmgn") && key !== "gmgnRequireKol"
      ? "gmgn"
      : key.startsWith("indicator") || key === "chartIndicatorsEnabled" || key === "rsiLength" || key === "requireAllIntervals"
        ? "indicators"
        : ["minBinsBelow", "maxBinsBelow"].includes(key)
          ? "strategy"
          : ["useDiscordSignals", "blockPvpSymbols", "managementIntervalMin", "screeningIntervalMin", "screeningSource", "gmgnRequireKol"].includes(key)
            ? "screen"
            : "risk";
  await answerCallbackQuery(msg.callbackQueryId, `Updated ${key}`);
  await showSettingsMenu({ messageId: msg.messageId, page });
}

function formatHelpText() {
  return [
    "Telegram commands",
    "",
    "/help — show commands",
    "/status — wallet + positions snapshot",
    "/wallet — wallet, deploy amount, HiveMind status",
    "/positions — list open positions",
    "/pool <n> — detailed info for one open position",
    "/close <n> — close one position by index",
    "/closeall — close all open positions",
    "/set <n> <note> — set note/instruction on position",
    "/config — show important runtime config",
    "/settings — button menu for common config",
    "/setcfg <key> <value> — update persisted config",
    "/screen — refresh deterministic candidate list",
    "/candidates — show latest cached candidates",
    "/deploy <n> — deploy candidate by cached index",
    "/briefing — morning briefing",
    "/hive — HiveMind sync status",
    "/hive pull — manual HiveMind pull now",
    "/pause — stop cron cycles",
    "/resume — start cron cycles again",
    "/stop — shut down agent",
  ].join("\n");
}

async function runDeterministicScreen(limit = 5) {
  const top = await getTopCandidates({ limit });
  const candidates = (top?.candidates || top?.pools || []).slice(0, limit);
  setLatestCandidates(candidates);
  if (candidates.length > 0) {
    const lines = candidates.map((pool, i) => {
      const feeTvl = pool.fee_active_tvl_ratio ?? pool.fee_tvl_ratio ?? "?";
      const vol = pool.volume_window ?? pool.volume_24h ?? "?";
      const source = pool.gmgn ? ` | GMGN smart ${pool.gmgn_smart_wallets ?? "?"}, KOL ${pool.gmgn_kol_wallets ?? "?"}, total fee ${pool.gmgn_total_fee_sol ?? "?"} SOL` : ` | organic ${pool.organic_score ?? "?"}`;
      return `${i + 1}. ${pool.name} | ${pool.pool}\n   fee/aTVL ${feeTvl}% | vol $${vol}${source}`;
    });
    return `Top candidates (${candidates.length})\n\n${lines.join("\n")}`;
  }
  const examples = (top?.filtered_examples || []).slice(0, 3)
    .map((entry) => `- ${entry.name}: ${entry.reason}`)
    .join("\n");
  return examples
    ? `No candidates available.\nFiltered examples:\n${examples}`
    : "No candidates available right now.";
}

async function deployLatestCandidate(index) {
  const candidate = _latestCandidates[index];
  if (!candidate) {
    throw new Error("Invalid candidate index. Run /screen first.");
  }
  if (_latestCandidates.length === 1) {
    const mint = candidate.base?.mint || candidate.base_mint || null;
    const [smartWallets, narrative, tokenInfo] = await Promise.allSettled([
      checkSmartWalletsOnPool({ pool_address: candidate.pool }),
      mint ? getTokenNarrative({ mint }) : Promise.resolve(null),
      mint ? getTokenInfo({ query: mint }) : Promise.resolve(null),
    ]);
    const context = {
      pool: candidate,
      sw: smartWallets.status === "fulfilled" ? smartWallets.value : null,
      n: narrative.status === "fulfilled" ? narrative.value : null,
      ti: tokenInfo.status === "fulfilled" ? tokenInfo.value?.results?.[0] : null,
    };
    const skipReason = getLoneCandidateSkipReason(context);
    if (skipReason) {
      appendDecision({
        type: "no_deploy",
        actor: "SCREENER",
        summary: "Single cached candidate skipped",
        reason: skipReason,
        pool: candidate.pool,
        pool_name: candidate.name,
      });
      throw new Error(`NO DEPLOY: only cached candidate ${candidate.name} is not worth deploying — ${skipReason}`);
    }
  }
  const deployAmount = computeDeployAmount((await getWalletBalances()).sol);
  const binsBelow = computeBinsBelow(candidate.volatility);
  const result = await executeTool("deploy_position", {
    pool_address: candidate.pool,
    amount_y: deployAmount,
    strategy: config.strategy.strategy,
    bins_below: binsBelow,
    bins_above: 0,
    pool_name: candidate.name,
    base_mint: candidate.base?.mint || candidate.base_mint || null,
    bin_step: candidate.bin_step,
    base_fee: candidate.base_fee,
    volatility: candidate.volatility,
    fee_tvl_ratio: candidate.fee_active_tvl_ratio ?? candidate.fee_tvl_ratio,
    organic_score: candidate.organic_score,
    initial_value_usd: candidate.tvl ?? candidate.active_tvl ?? null,
  });
  if (result?.success === false || result?.error) {
    throw new Error(result.error || "Deploy failed");
  }
  return { result, candidate, deployAmount, binsBelow };
}

async function runScreeningCycle({ silent = false } = {}) {
  if (_screeningBusy || busy) return null;
  _screeningBusy = true;
  timers.screeningLastRun = Date.now();
  try {
    const report = await runDeterministicScreen(5);
    if (!silent && telegramEnabled()) await sendMessage(report).catch(() => {});
    return report;
  } catch (error) {
    log("screening", `Screening cycle failed: ${error.message}`);
    if (!silent && telegramEnabled()) await sendMessage(`Screening error: ${error.message}`).catch(() => {});
    return null;
  } finally {
    _screeningBusy = false;
  }
}

export async function runWhaleActivityCheck({ silent = false } = {}) {
  if (_managementBusy || _whaleActivityBusy) return null;
  if (!config.management.whaleEscapeEnabled) return null;

  _whaleActivityBusy = true;
  timers.whaleActivityLastRun = Date.now();
  try {
    const livePositions = await getMyPositions({ force: true, silent: true }).catch(() => null);
    const positions = livePositions?.positions || [];
    if (!positions.length) return null;

    const whaleAlertsByMint = new Map();
    for (const p of positions) {
      if (!p.base_mint || whaleAlertsByMint.has(p.base_mint)) continue;
      const signal = await getWhaleEscapeSignal(p, config.management);
      if (signal) whaleAlertsByMint.set(p.base_mint, signal);
    }

    if (!whaleAlertsByMint.size) return null;

    const warnings = [];
    const results = [];
    for (const p of positions) {
      const signal = p.base_mint ? whaleAlertsByMint.get(p.base_mint) : null;
      if (!signal) continue;
      try {
        if (signal.severity === "warn") {
          warnings.push(`?? ${p.pair}\nReason: ${signal.reason}`);
          continue;
        }

        const result = await closePosition({ position_address: p.position, reason: `whale escape auto-check: ${signal.reason}` });
        if (result.success) {
          const closeTxs = result.close_txs?.length ? result.close_txs : result.txs;
          results.push(`? Position Closed ? ${p.pair}\nReason: ${signal.reason}\nTx: ${closeTxs?.[0] ?? "n/a"}`);
        } else {
          results.push(`? Position Close Failed ? ${p.pair}\nReason: ${signal.reason}\nError: ${result.error || JSON.stringify(result)}`);
        }
      } catch (error) {
        results.push(`? Position Close Failed ? ${p.pair}\nReason: ${signal.reason}\nError: ${error.message}`);
      }
    }

    const sections = [];
    sections.push(formatWhaleEscapeConfigSummary(config.management));
    if (warnings.length) sections.push(`Warnings:\n${warnings.join("\n\n")}`);
    if (results.length) sections.push(`Closes:\n${results.join("\n\n")}`);
    const whaleReport = `?? Whale Escape\n${sections.join("\n")}`;
    if (!silent && telegramEnabled()) await sendMessage(whaleReport).catch(() => {});
    return whaleReport;
  } catch (error) {
    log("whale_activity", `Whale Escape watcher failed: ${error.message}`);
    if (!silent && telegramEnabled()) await sendMessage(`🐳 Whale Escape watcher error: ${error.message}`).catch(() => {});
    return null;
  } finally {
    _whaleActivityBusy = false;
  }
}

function stopCronJobs() {
  for (const task of _cronTasks) {
    try { task?.stop?.(); } catch {}
    try { task?.destroy?.(); } catch {}
  }
  _cronTasks = [];
}

function startCronJobs() {
  stopCronJobs();
  const screeningTask = cron.schedule(`*/${Math.max(1, config.schedule.screeningIntervalMin)} * * * *`, async () => {
    if (_managementBusy || _screeningBusy || busy) return;
    await runScreeningCycle({ silent: true });
  });
  const whaleTask = cron.schedule(`*/${Math.max(1, config.schedule.whaleActivityIntervalMin)} * * * *`, async () => {
    if (_managementBusy || _whaleActivityBusy || busy) return;
    await runWhaleActivityCheck({ silent: true });
  });
  _cronTasks = [screeningTask, whaleTask];
}

function appendHistory(userMsg, assistantMsg) {
  sessionHistory.push({ role: "user", content: userMsg });
  sessionHistory.push({ role: "assistant", content: assistantMsg });
  // Trim to last MAX_HISTORY messages
  if (sessionHistory.length > MAX_HISTORY) {
    sessionHistory.splice(0, sessionHistory.length - MAX_HISTORY);
  }
}

function refreshPrompt() {
  if (!_ttyInterface) return;
  _ttyInterface.setPrompt(buildPrompt());
  _ttyInterface.prompt(true);
}

async function drainTelegramQueue() {
  while (_telegramQueue.length > 0 && !_managementBusy && !_screeningBusy && !busy) {
    const queued = _telegramQueue.shift();
    await telegramHandler(queued);
  }
}

async function telegramHandler(msg) {
  const text = msg?.text?.trim();
  if (!text) return;

  if (_pendingInput && !msg.isCallback && !text.startsWith("/")) {
    const { key, page, menuMsgId } = _pendingInput;
    _pendingInput = null;
    let value;
    if (text.toLowerCase() === "off" || text.toLowerCase() === "null") {
      value = null;
    } else {
      value = Number(text);
      if (!Number.isFinite(value)) {
        await sendMessage(`Invalid value "${text}" — must be a number or "off".`);
        return;
      }
    }
    const result = await executeTool("update_config", { changes: { [key]: value }, reason: "Telegram input field" });
    if (!result?.success) {
      await sendMessage(`Failed to update ${key}.`);
      return;
    }
    await showSettingsMenu({ messageId: menuMsgId, page });
    return;
  }
  if (msg?.isCallback && text.startsWith("cfg:")) {
    try {
      await applySettingsMenuCallback(msg);
    } catch (e) {
      await answerCallbackQuery(msg.callbackQueryId, e.message).catch(() => {});
    }
    return;
  }
  if (text === "/settings" || text === "/menu" || text === "/configmenu") {
    await showSettingsMenu().catch((e) => sendMessage(`Settings error: ${e.message}`).catch(() => {}));
    return;
  }
  if (_managementBusy || _screeningBusy || busy) {
    if (_telegramQueue.length < 5) {
      _telegramQueue.push(msg);
      sendMessage(`⏳ Queued (${_telegramQueue.length} in queue): "${text.slice(0, 60)}"`).catch(() => {});
    } else {
      sendMessage("Queue is full (5 messages). Wait for the agent to finish.").catch(() => {});
    }
    return;
  }

  if (text === "/briefing") {
    try {
      const briefing = await generateBriefing();
      await sendHTML(briefing);
    } catch (e) {
      await sendMessage(`Error: ${e.message}`).catch(() => {});
    }
    return;
  }

  if (text === "/help") {
    await sendMessage(formatHelpText()).catch(() => {});
    return;
  }

  if (text === "/wallet" || text === "/status") {
    try {
      const [wallet, positions] = await Promise.all([getWalletBalances(), getMyPositions({ force: true })]);
      const suffix = text === "/status" && positions.total_positions
        ? `\n\nUse /positions for the numbered list.`
        : "";
      await sendMessage(`${formatWalletStatus(wallet, positions)}${suffix}`).catch(() => {});
    } catch (e) {
      await sendMessage(`Error: ${e.message}`).catch(() => {});
    }
    return;
  }

  if (text === "/config") {
    await sendMessage(formatConfigSnapshot()).catch(() => {});
    return;
  }

  if (text === "/positions") {
    try {
      const { positions, total_positions } = await getMyPositions({ force: true });
      if (total_positions === 0) { await sendMessage("No open positions."); return; }
      const lines = positions.map((p, i) => {
        const pnlVal = p.pnl_sol ?? p.pnl_usd ?? 0;
        const pnl = pnlVal >= 0 ? `+◎${pnlVal}` : `-◎${Math.abs(pnlVal)}`;
        const age = p.age_minutes != null ? `${p.age_minutes}m` : "?";
        const oor = !p.in_range ? " ⚠️OOR" : "";
        return `${i + 1}. ${p.pair} | ◎${p.total_value_usd} | PnL: ${pnl} SOL | fees: ◎${p.unclaimed_fees_usd} | ${age}${oor}`;
      });
      await sendMessage(`📊 Open Positions (${total_positions}):\n\n${lines.join("\n")}\n\n/close <n> to close | /set <n> <note> to set instruction`);
    } catch (e) { await sendMessage(`Error: ${e.message}`).catch(() => {}); }
    return;
  }

  const poolMatch = text.match(/^\/pool\s+(\d+)$/i);
  if (poolMatch) {
    try {
      const idx = parseInt(poolMatch[1]) - 1;
      const { positions } = await getMyPositions({ force: true });
      if (idx < 0 || idx >= positions.length) { await sendMessage("Invalid number. Use /positions first."); return; }
      const pos = positions[idx];
      await sendMessage([
        `${idx + 1}. ${pos.pair}`,
        `Pool: ${pos.pool}`,
        `Position: ${pos.position}`,
        `Range: ${pos.lower_bin} → ${pos.upper_bin} | active ${pos.active_bin}`,
        `PnL: ${pos.pnl_pct ?? "?"}% (◎${pos.pnl_sol ?? pos.pnl_usd ?? "?"}) | fees: ◎${pos.unclaimed_fees_usd ?? "?"}`,
        `Value: ◎${pos.total_value_usd ?? "?"}`,
        `Age: ${pos.age_minutes ?? "?"}m | ${pos.in_range ? "IN RANGE" : `OOR ${pos.minutes_out_of_range ?? 0}m`}`,
        pos.instruction ? `Note: ${pos.instruction}` : null,
      ].filter(Boolean).join("\n"));
    } catch (e) {
      await sendMessage(`Error: ${e.message}`).catch(() => {});
    }
    return;
  }

  const closeMatch = text.match(/^\/close\s+(\d+)$/i);
  if (closeMatch) {
    try {
      const idx = parseInt(closeMatch[1]) - 1;
      const { positions } = await getMyPositions({ force: true });
      if (idx < 0 || idx >= positions.length) { await sendMessage("Invalid number. Use /positions first."); return; }
      const pos = positions[idx];
      await sendMessage(`Closing ${pos.pair}...`);
      const result = await closePosition({ position_address: pos.position });
        if (result.success) {
        const closeTxs = result.close_txs?.length ? result.close_txs : result.txs;
        const claimNote = result.claim_txs?.length ? `\nClaim txs: ${result.claim_txs.join(", ")}` : "";
        await sendMessage(`✅ Closed ${pos.pair}\nPnL: ◎${result.pnl_sol ?? result.pnl_usd ?? "?"} SOL (${result.pnl_pct ?? "?"}%) | close txs: ${closeTxs?.join(", ") || "n/a"}${claimNote}`);

        if (result.base_mint) {
          const swapResult = await swapClosedBaseMintToSol(result.base_mint);
          if (swapResult?.success) {
            await sendMessage(`🔁 Swapped ${result.base_mint} → SOL\nTx: ${swapResult.tx}`);
          } else if (swapResult?.skipped) {
            await sendMessage(`⚠️ Swap skipped: ${swapResult.reason}`);
          } else if (swapResult?.error) {
            await sendMessage(`⚠️ Swap failed: ${swapResult.error}`);
          }
        }
      } else {
        await sendMessage(`❌ Close failed: ${JSON.stringify(result)}`);
      }
    } catch (e) { await sendMessage(`Error: ${e.message}`).catch(() => {}); }
    return;
  }

  if (text === "/closeall") {
    try {
      const { positions } = await getMyPositions({ force: true });
      if (!positions.length) { await sendMessage("No open positions."); return; }
      await sendMessage(`Closing ${positions.length} position(s)...`);
      const results = [];
      for (const pos of positions) {
        try {
          const result = await closePosition({ position_address: pos.position });
          results.push(`${pos.pair}: ${result.success ? "closed" : `failed (${result.error || "unknown"})`}`);
        } catch (error) {
          results.push(`${pos.pair}: failed (${error.message})`);
        }
      }
      await sendMessage(`Close-all finished.\n\n${results.join("\n")}`).catch(() => {});
    } catch (e) {
      await sendMessage(`Error: ${e.message}`).catch(() => {});
    }
    return;
  }

  const setMatch = text.match(/^\/set\s+(\d+)\s+(.+)$/i);
  if (setMatch) {
    try {
      const idx = parseInt(setMatch[1]) - 1;
      const note = setMatch[2].trim();
      const { positions } = await getMyPositions({ force: true });
      if (idx < 0 || idx >= positions.length) { await sendMessage("Invalid number. Use /positions first."); return; }
      const pos = positions[idx];
      setPositionInstruction(pos.position, note);
      await sendMessage(`✅ Note set for ${pos.pair}:\n"${note}"`);
    } catch (e) { await sendMessage(`Error: ${e.message}`).catch(() => {}); }
    return;
  }

  const setCfgMatch = text.match(/^\/setcfg\s+([A-Za-z0-9_]+)\s+(.+)$/i);
  if (setCfgMatch) {
    try {
      const key = setCfgMatch[1];
      const value = parseConfigValue(setCfgMatch[2]);
      const result = await executeTool("update_config", {
        changes: { [key]: value },
        reason: "Telegram slash command /setcfg",
      });
      if (!result?.success) {
        await sendMessage(`Config update failed.\nUnknown: ${(result?.unknown || []).join(", ") || "none"}`).catch(() => {});
        return;
      }
      await sendMessage(`✅ Updated ${key} = ${JSON.stringify(value)}`).catch(() => {});
    } catch (e) {
      await sendMessage(`Error: ${e.message}`).catch(() => {});
    }
    return;
  }

  if (text === "/screen") {
    try {
      await sendMessage(await runDeterministicScreen(5)).catch(() => {});
    } catch (e) {
      await sendMessage(`Error: ${e.message}`).catch(() => {});
    }
    return;
  }

  if (text === "/candidates") {
    await sendMessage(describeLatestCandidates(5)).catch(() => {});
    return;
  }

  const deployMatch = text.match(/^\/deploy\s+(\d+)$/i);
  if (deployMatch) {
    try {
      const idx = parseInt(deployMatch[1]) - 1;
      const { candidate, result, deployAmount, binsBelow } = await deployLatestCandidate(idx);
      const coverage = result.range_coverage
        ? `Range: ${fmtPct(result.range_coverage.downside_pct)} downside | ${fmtPct(result.range_coverage.upside_pct)} upside`
        : `Strategy: ${config.strategy.strategy} | binsBelow: ${binsBelow}`;
      await sendMessage([
        `✅ Deployed ${candidate.name}`,
        `Pool: ${candidate.pool}`,
        `Amount: ${deployAmount} SOL`,
        coverage,
        `Position: ${result.position || "n/a"}`,
        result.txs?.length ? `Tx: ${result.txs[0]}` : null,
      ].filter(Boolean).join("\n")).catch(() => {});
    } catch (e) {
      await sendMessage(`Error: ${e.message}`).catch(() => {});
    }
    return;
  }

  if (text === "/pause") {
    stopCronJobs();
    cronStarted = false;
    await sendMessage("⏸ Paused autonomous cycles. Telegram control still works. Use /resume to start again.").catch(() => {});
    return;
  }

  if (text === "/resume") {
    if (!cronStarted) {
      cronStarted = true;
      timers.managementLastRun = Date.now();
      timers.screeningLastRun = Date.now();
      timers.whaleActivityLastRun = Date.now();
      startCronJobs();
      await sendMessage("▶️ Autonomous cycles resumed.").catch(() => {});
    } else {
      await sendMessage("Autonomous cycles are already running.").catch(() => {});
    }
    return;
  }

  if (text === "/hive" || text === "/hive pull") {
    try {
      const enabled = isHiveMindEnabled();
      const agentId = ensureAgentId();
      if (!enabled) {
        await sendMessage(`HiveMind: disabled\nAgent ID: ${agentId}\nSet hiveMindApiKey to connect.`).catch(() => {});
        return;
      }
      const isManualPull = text === "/hive pull";
      const pullMode = getHiveMindPullMode();
      const [registerResult, lessons, presets] = await Promise.all([
        registerHiveMindAgent({ reason: isManualPull ? "telegram_pull" : "telegram_status" }),
        (pullMode === "auto" || isManualPull) ? pullHiveMindLessons(12) : Promise.resolve(null),
        (pullMode === "auto" || isManualPull) ? pullHiveMindPresets() : Promise.resolve(null),
      ]);
      await sendMessage([
        "HiveMind: enabled",
        `Agent ID: ${agentId}`,
        `URL: ${config.hiveMind.url}`,
        `Pull mode: ${pullMode}`,
        `Register: ${registerResult ? "ok" : "warn"}`,
        `Shared lessons: ${Array.isArray(lessons) ? lessons.length : (pullMode === "manual" ? "manual" : 0)}`,
        `Presets: ${Array.isArray(presets) ? presets.length : (pullMode === "manual" ? "manual" : 0)}`,
        isManualPull ? "Manual pull: completed" : null,
      ].join("\n")).catch(() => {});
    } catch (e) {
      await sendMessage(`HiveMind error: ${e.message}`).catch(() => {});
    }
    return;
  }

  busy = true;
  let liveMessage = null;
  try {
    log("telegram", `Incoming: ${text}`);
    const hasCloseIntent = /\bclose\b|\bsell\b|\bexit\b|\bwithdraw\b/i.test(text);
    const isDeployRequest = !hasCloseIntent && /\bdeploy\b|\bopen position\b|\blp into\b|\badd liquidity\b/i.test(text);
    const agentRole = isDeployRequest ? "SCREENER" : "GENERAL";
    const agentModel = agentRole === "SCREENER" ? config.llm.screeningModel : config.llm.generalModel;
    liveMessage = await createLiveMessage("🤖 Live Update", `Request: ${text.slice(0, 240)}`);
    const { content } = await agentLoop(text, config.llm.maxSteps, sessionHistory, agentRole, agentModel, null, {
      interactive: true,
      onToolStart: async ({ name }) => { await liveMessage?.toolStart(name); },
      onToolFinish: async ({ name, result, success }) => { await liveMessage?.toolFinish(name, result, success); },
    });
    appendHistory(text, content);
    if (liveMessage) await liveMessage.finalize(stripThink(content));
    else await sendMessage(stripThink(content));
  } catch (e) {
    if (liveMessage) await liveMessage.fail(e.message).catch(() => {});
    else await sendMessage(`Error: ${e.message}`).catch(() => {});
  } finally {
    busy = false;
    refreshPrompt();
    drainTelegramQueue().catch(() => {});
  }
}

function fmtPct(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(2)}%` : "?";
}

// Register restarter — when update_config changes intervals, running cron jobs get replaced
registerCronRestarter(() => { if (cronStarted) startCronJobs(); });

if (isMain && isTTY) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: buildPrompt(),
  });
  _ttyInterface = rl;

  // Update prompt countdown every 10 seconds
  setInterval(() => {
    if (!busy) {
      rl.setPrompt(buildPrompt());
      rl.prompt(true); // true = preserve current line
    }
  }, 10_000);

  function launchCron() {
    if (!cronStarted) {
      cronStarted = true;
      // Seed timers so countdown starts from now
      timers.managementLastRun = Date.now();
      timers.screeningLastRun = Date.now();
      timers.whaleActivityLastRun = Date.now();
      startCronJobs();
      console.log("Autonomous cycles are now running.\n");
      rl.setPrompt(buildPrompt());
      rl.prompt(true);
    }
  }

  async function runBusy(fn) {
    if (busy) { console.log("Agent is busy, please wait..."); rl.prompt(); return; }
    busy = true; rl.pause();
    try { await fn(); }
    catch (e) { console.error(`Error: ${e.message}`); }
    finally { busy = false; rl.setPrompt(buildPrompt()); rl.resume(); rl.prompt(); }
  }

  // ── Startup: show wallet + top candidates ──
  console.log(`
╔═══════════════════════════════════════════╗
║         DLMM LP Agent — Ready             ║
╚═══════════════════════════════════════════╝
`);

  console.log("Fetching wallet and top pool candidates...\n");

  busy = true;
  try {
    const [wallet, positions, { candidates, total_eligible, total_screened }] = await Promise.all([
      getWalletBalances(),
      getMyPositions({ force: true }),
      getTopCandidates({ limit: 5 }),
    ]);

    setLatestCandidates(candidates);

    console.log(`Wallet:    ${wallet.sol} SOL  ($${wallet.sol_usd})  |  SOL price: $${wallet.sol_price}`);
    console.log(`Positions: ${positions.total_positions} open\n`);

    if (positions.total_positions > 0) {
      console.log("Open positions:");
      for (const p of positions.positions) {
        const status = p.in_range ? "in-range ✓" : "OUT OF RANGE ⚠";
        console.log(`  ${p.pair.padEnd(16)} ${status}  fees: $${p.unclaimed_fees_usd}`);
      }
      console.log();
    }

    console.log(`Top pools (${total_eligible} eligible from ${total_screened} screened):\n`);
    console.log(formatCandidates(candidates));

  } catch (e) {
    console.error(`Startup fetch failed: ${e.message}`);
  } finally {
    busy = false;
  }

  // Always start autonomous cycles on launch
  launchCron();
  maybeRunMissedBriefing().catch(() => { });

  startPolling(telegramHandler);

  console.log(`
Commands:
  1 / 2 / 3 ...  Deploy ${DEPLOY} SOL into that pool
  auto           Let the agent pick and deploy automatically
  /status        Refresh wallet + positions
  /candidates    Refresh top pool list
  /briefing      Show morning briefing (last 24h)
  /learn         Study top LPers from the best current pool and save lessons
  /learn <addr>  Study top LPers from a specific pool address
  /thresholds    Show current screening thresholds + performance stats
  /evolve        Manually trigger threshold evolution from performance data
  /stop          Shut down
`);

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    // ── Number pick: deploy into pool N ─────
    const pick = parseInt(input);
    const latest = getLatestCandidatesMeta().candidates;
    if (!isNaN(pick) && pick >= 1 && pick <= latest.length) {
      await runBusy(async () => {
        const pool = latest[pick - 1];
        console.log(`\nDeploying ${DEPLOY} SOL into ${pool.name}...\n`);
        const { content: reply } = await agentLoop(
          `Deploy ${DEPLOY} SOL into pool ${pool.pool} (${pool.name}). Call get_active_bin first then deploy_position. Report result.`,
          config.llm.maxSteps,
          [],
          "SCREENER"
        );
        console.log(`\n${reply}\n`);
        launchCron();
      });
      return;
    }

    // ── auto: agent picks and deploys ───────
    if (input.toLowerCase() === "auto") {
      await runBusy(async () => {
        console.log("\nAgent is screening for a deploy-worthy candidate...\n");
        const { content: reply } = await agentLoop(
          `get_top_candidates, decide whether any candidate is worth deploying, and only call deploy_position with ${DEPLOY} SOL if conviction is strong. If only one candidate is returned and it lacks narrative or smart-wallet confirmation, skip and report NO DEPLOY. Execute now, don't ask.`,
          config.llm.maxSteps,
          [],
          "SCREENER"
        );
        console.log(`\n${reply}\n`);
        launchCron();
      });
      return;
    }

    // ── go: start cron without deploying ────
    if (input.toLowerCase() === "go") {
      launchCron();
      rl.prompt();
      return;
    }

    // ── Slash commands ───────────────────────
    if (input === "/stop") { await shutdown("user command"); return; }

    if (input === "/status") {
      await runBusy(async () => {
        const [wallet, positions] = await Promise.all([getWalletBalances(), getMyPositions({ force: true })]);
        console.log(`\nWallet: ${wallet.sol} SOL  ($${wallet.sol_usd})`);
        console.log(`Positions: ${positions.total_positions}`);
        for (const p of positions.positions) {
          const status = p.in_range ? "in-range ✓" : "OUT OF RANGE ⚠";
          console.log(`  ${p.pair.padEnd(16)} ${status}  fees: ${config.management.solMode ? "◎" : "$"}${p.unclaimed_fees_usd}`);
        }
        console.log();
      });
      return;
    }

    if (input === "/briefing") {
      await runBusy(async () => {
        const briefing = await generateBriefing();
        console.log(`\n${briefing.replace(/<[^>]*>/g, "")}\n`);
      });
      return;
    }

    if (input === "/candidates") {
      await runBusy(async () => {
        const { candidates, total_eligible, total_screened } = await getTopCandidates({ limit: 5 });
        setLatestCandidates(candidates);
        console.log(`\nTop pools (${total_eligible} eligible from ${total_screened} screened):\n`);
        console.log(formatCandidates(candidates));
        console.log();
      });
      return;
    }

    if (input === "/thresholds") {
      const s = config.screening;
      console.log("\nCurrent screening thresholds:");
      console.log(`  minFeeActiveTvlRatio: ${s.minFeeActiveTvlRatio}`);
      console.log(`  minOrganic:           ${s.minOrganic}`);
      console.log(`  minHolders:           ${s.minHolders}`);
      console.log(`  minTvl:               ${s.minTvl}`);
      console.log(`  maxTvl:               ${s.maxTvl}`);
      console.log(`  minVolume:            ${s.minVolume}`);
      console.log(`  minTokenFeesSol:      ${s.minTokenFeesSol}`);
      console.log(`  maxBundlePct:         ${s.maxBundlePct}`);
      console.log(`  maxBotHoldersPct:     ${s.maxBotHoldersPct}`);
      console.log(`  maxTop10Pct:          ${s.maxTop10Pct}`);
      console.log(`  timeframe:            ${s.timeframe}`);
      const perf = getPerformanceSummary();
      if (perf) {
        console.log(`\n  Based on ${perf.total_positions_closed} closed positions`);
        console.log(`  Win rate: ${perf.win_rate_pct}%  |  Avg PnL: ${perf.avg_pnl_pct}%`);
      } else {
        console.log("\n  No closed positions yet — thresholds are preset defaults.");
      }
      console.log();
      rl.prompt();
      return;
    }

    if (input.startsWith("/learn")) {
      await runBusy(async () => {
        const parts = input.split(" ");
        const poolArg = parts[1] || null;

        let poolsToStudy = [];

        if (poolArg) {
          poolsToStudy = [{ pool: poolArg, name: poolArg }];
        } else {
          // Fetch top 10 candidates across all eligible pools
          console.log("\nFetching top pool candidates to study...\n");
          const { candidates } = await getTopCandidates({ limit: 10 });
          if (!candidates.length) {
            console.log("No eligible pools found to study.\n");
            return;
          }
          poolsToStudy = candidates.map((c) => ({ pool: c.pool, name: c.name }));
        }

        console.log(`\nStudying top LPers across ${poolsToStudy.length} pools...\n`);
        for (const p of poolsToStudy) console.log(`  • ${p.name || p.pool}`);
        console.log();

        const poolList = poolsToStudy
          .map((p, i) => `${i + 1}. ${p.name} (${p.pool})`)
          .join("\n");

        const { content: reply } = await agentLoop(
          `Study top LPers across these ${poolsToStudy.length} pools by calling study_top_lpers for each:

${poolList}

For each pool, call study_top_lpers then move to the next. After studying all pools:
1. Identify patterns that appear across multiple pools (hold time, scalping vs holding, win rates).
2. Note pool-specific patterns where behaviour differs significantly.
3. Derive 4-8 concrete, actionable lessons using add_lesson. Prioritize cross-pool patterns — they're more reliable.
4. Summarize what you learned.

Focus on: hold duration, entry/exit timing, what win rates look like, whether scalpers or holders dominate.`,
          config.llm.maxSteps,
          [],
          "GENERAL"
        );
        console.log(`\n${reply}\n`);
      });
      return;
    }

    if (input === "/evolve") {
      await runBusy(async () => {
        const perf = getPerformanceSummary();
        if (!perf || perf.total_positions_closed < 5) {
          const needed = 5 - (perf?.total_positions_closed || 0);
          console.log(`\nNeed at least 5 closed positions to evolve. ${needed} more needed.\n`);
          return;
        }
        const fs = await import("fs");
        const lessonsData = JSON.parse(fs.default.readFileSync("./lessons.json", "utf8"));
        const result = evolveThresholds(lessonsData.performance, config);
        if (!result || Object.keys(result.changes).length === 0) {
          console.log("\nNo threshold changes needed — current settings already match performance data.\n");
        } else {
          reloadScreeningThresholds();
          console.log("\nThresholds evolved:");
          for (const [key, val] of Object.entries(result.changes)) {
            console.log(`  ${key}: ${result.rationale[key]}`);
          }
          console.log("\nSaved to user-config.json. Applied immediately.\n");
        }
      });
      return;
    }

    // ── Free-form chat ───────────────────────
    await runBusy(async () => {
      log("user", input);
      const { content } = await agentLoop(input, config.llm.maxSteps, sessionHistory, "GENERAL", config.llm.generalModel, null, { interactive: true });
      appendHistory(input, content);
      console.log(`\n${content}\n`);
    });
  });

  rl.on("close", () => shutdown("stdin closed"));

} else if (isMain) {
  // Non-TTY: start immediately
  log("startup", "Non-TTY mode — starting cron cycles immediately.");
  startCronJobs();
  maybeRunMissedBriefing().catch(() => { });
  startPolling(telegramHandler);
  (async () => {
    try {
      await runScreeningCycle({ silent: false });
    } catch (e) {
      log("startup_error", e.message);
    }
  })();
}
