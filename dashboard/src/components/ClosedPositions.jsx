import { formatPercent, formatSol, shortenAddress, timeAgo } from "../utils/format";

function ClosedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-400/15 px-2 py-0.5 text-xs font-medium text-subtle dark:bg-zinc-500/15 dark:text-zinc-400">
      <span className="h-1.5 w-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500" />
      Closed
    </span>
  );
}

export default function ClosedPositions({ positions = [] }) {
  return (
    <section className="rounded-xl border border-surface-border bg-surface-card shadow-sm dark:shadow-none">
      <div className="border-b border-surface-border px-4 py-3">
        <h2 className="text-sm font-medium text-foreground">Posisi tertutup</h2>
        <p className="text-xs text-muted">{positions.length} posisi LP sudah ditutup</p>
      </div>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead>
            <tr className="border-b border-surface-border text-xs uppercase tracking-wider text-muted">
              <th className="px-4 py-2.5 font-medium">Pair</th>
              <th className="px-4 py-2.5 font-medium">Nilai akhir</th>
              <th className="px-4 py-2.5 font-medium">PnL</th>
              <th className="px-4 py-2.5 font-medium">Fees</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {positions.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted">
                  Belum ada posisi tertutup
                </td>
              </tr>
            )}
            {positions.map((pos) => {
              const addr = pos.position || pos.id;
              return (
                <tr
                  key={`${addr}-${pos.closedAt || ""}`}
                  className="row-hover border-b border-surface-border/60 last:border-0"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{pos.pair}</div>
                    <div className="text-xs text-muted">
                      {pos.poolLabel || pos.pool || "Meteora"} · {shortenAddress(addr, 4)}
                      {pos.binStep != null ? ` · bin ${pos.binStep}` : ""}
                    </div>
                    {pos.closeReason && (
                      <p className="mt-1 line-clamp-2 text-xs text-subtle" title={pos.closeReason}>
                        {pos.closeReason}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-foreground/80">
                    {formatSol(pos.sizeSol ?? pos.finalValueSol)}
                  </td>
                  <td
                    className={`px-4 py-3 font-mono font-medium ${
                      (pos.pnlPercent ?? 0) >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    <div>{formatPercent(pos.pnlPercent, { signed: true })}</div>
                    {pos.pnlSol != null && (
                      <div className="text-xs font-normal opacity-80">
                        {formatSol(pos.pnlSol, { decimals: 3 })}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-foreground/80">
                    {formatSol(pos.feesSol ?? pos.fees)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      <ClosedBadge />
                      {pos.closedAt && (
                        <p className="text-[10px] text-subtle">{timeAgo(pos.closedAt)}</p>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
