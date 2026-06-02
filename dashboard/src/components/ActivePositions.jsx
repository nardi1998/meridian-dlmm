import { formatPercent, formatSol, shortenAddress } from "../utils/format";

function StatusBadge({ status }) {
  const inRange = status === "in_range";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        inRange
          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${inRange ? "bg-emerald-500" : "bg-amber-500"}`} />
      {inRange ? "In range" : "Out of range"}
    </span>
  );
}

export default function ActivePositions({ positions = [] }) {
  return (
    <section className="rounded-xl border border-surface-border bg-surface-card p-0 shadow-sm dark:shadow-none">
      <div className="border-b border-surface-border px-4 py-3">
        <h2 className="text-sm font-medium text-foreground">Posisi aktif</h2>
        <p className="text-xs text-muted">{positions.length} posisi LP terbuka</p>
      </div>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead>
            <tr className="border-b border-surface-border text-xs uppercase tracking-wider text-muted">
              <th className="px-4 py-2.5 font-medium">Pair</th>
              <th className="px-4 py-2.5 font-medium">Nilai</th>
              <th className="px-4 py-2.5 font-medium">PnL</th>
              <th className="px-4 py-2.5 font-medium">Fees</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {positions.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted">
                  Tidak ada posisi terbuka
                </td>
              </tr>
            )}
            {positions.map((pos) => {
              const addr = pos.position || pos.id;
              return (
                <tr key={addr} className="row-hover border-b border-surface-border/60 last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{pos.pair}</div>
                    <div className="text-xs text-muted">
                      {pos.poolLabel || pos.pool || "Meteora"} · {shortenAddress(addr, 4)}
                      {pos.binStep != null ? ` · bin ${pos.binStep}` : ""}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-foreground/80">
                    {formatSol(pos.sizeSol ?? pos.size)}
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
                    <StatusBadge status={pos.status} />
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
