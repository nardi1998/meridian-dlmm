import { formatPercent, formatSol } from "../utils/format";

function StatCard({ label, value, sub, positive }) {
  return (
    <div className="rounded-xl border border-surface-border bg-surface-card p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold text-foreground">{value}</p>
      {sub && (
        <p
          className={`mt-1 text-xs font-medium ${
            positive === true
              ? "text-emerald-400"
              : positive === false
                ? "text-red-400"
                : "text-muted"
          }`}
        >
          {sub}
        </p>
      )}
    </div>
  );
}

export default function Overview({ overview, paused, solPrice, source }) {
  const running = !paused;
  const o = overview || {};

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-muted">Ringkasan</h2>
        <span className="text-xs text-subtle">
          Denominasi SOL
          {solPrice ? ` · 1 SOL ≈ $${Number(solPrice).toFixed(2)}` : ""}
          {source === "mock" && " · data mock"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard
          label="Total Balance"
          value={formatSol(o.totalBalanceSol)}
          sub={
            o.walletSol != null
              ? `Wallet ${formatSol(o.walletSol, { compact: true })} + LP ${formatSol(o.lpSol, { compact: true })}`
              : o.balanceChange24h != null
                ? `${formatPercent(o.balanceChange24h, { signed: true })} 24j`
                : "SOL + posisi LP"
          }
          positive={o.balanceChange24h == null ? undefined : o.balanceChange24h >= 0}
        />
        <StatCard
          label="PnL"
          value={formatSol(o.pnlSol)}
          sub={o.pnlPercent != null ? formatPercent(o.pnlPercent, { signed: true }) : "unrealized + closed"}
          positive={(o.pnlSol ?? 0) >= 0}
        />
        <StatCard
          label="Posisi aktif"
          value={o.activePositions ?? 0}
          sub="Meteora DLMM"
        />
        <StatCard
          label="Fees earned"
          value={formatSol(o.feesEarnedSol)}
          sub={
            o.feesChange24hSol != null
              ? `+${formatSol(o.feesChange24hSol)} 24j`
              : "terklaim + belum diklaim"
          }
          positive
        />
        <StatCard
          label="Status agent"
          value={running ? "Running" : "Paused"}
          sub={running ? "Semua agent aktif" : "Siklus dijeda"}
          positive={running ? true : undefined}
        />
      </div>
    </section>
  );
}
