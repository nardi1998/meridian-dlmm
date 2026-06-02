export function formatSol(value, { compact = false, decimals = 4 } = {}) {
  if (value == null || Number.isNaN(value)) return "— SOL";
  const n = Number(value);
  if (compact && Math.abs(n) >= 1000) {
    return `${(n / 1000).toFixed(2)}K SOL`;
  }
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 2 : abs >= 1 ? decimals : 6;
  const formatted = n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
  return `${formatted} SOL`;
}

export function formatUsd(value, { compact = false } = {}) {
  if (compact && Math.abs(value) >= 1e6) {
    return `$${(value / 1e6).toFixed(1)}M`;
  }
  if (compact && Math.abs(value) >= 1e3) {
    return `$${(value / 1e3).toFixed(1)}K`;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPercent(value, { signed = false } = {}) {
  if (value == null || Number.isNaN(value)) return "—";
  const prefix = signed && value > 0 ? "+" : "";
  return `${prefix}${Number(value).toFixed(1)}%`;
}

export function formatVolume(value) {
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value}`;
}

export function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function shortenAddress(addr, chars = 4) {
  if (!addr || addr.length < 12) return addr || "";
  return `${addr.slice(0, chars)}…${addr.slice(-chars)}`;
}
