import { formatVolume } from "../utils/format";

export default function Opportunities({ opportunities = [] }) {
  const sorted = [...opportunities].sort((a, b) => b.score - a.score);

  return (
    <section className="rounded-xl border border-surface-border bg-surface-card shadow-sm dark:shadow-none">
      <div className="border-b border-surface-border px-4 py-3">
        <h2 className="text-sm font-medium text-foreground">Opportunities</h2>
        <p className="text-xs text-muted">Screened Meteora DLMM pools</p>
      </div>
      <ul className="max-h-[280px] divide-y divide-surface-border/60 overflow-y-auto scrollbar-thin">
        {sorted.map((opp, i) => (
          <li
            key={opp.id}
            className={`row-hover flex items-center justify-between gap-3 px-4 py-3 ${
              opp.highlight ? "bg-blue-500/[0.08] dark:bg-blue-500/[0.06]" : ""
            }`}
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-raised text-xs font-mono text-muted">
                {i + 1}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-foreground">{opp.pair}</span>
                  {opp.highlight && (
                    <span className="shrink-0 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                      Top pick
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted">
                  Vol {formatVolume(opp.volume24h)} · Fee/TVL {(opp.feeTvl * 100).toFixed(0)}%
                </p>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-mono text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                {opp.apr.toFixed(1)}%
              </p>
              <p className="text-[10px] uppercase text-muted">APR</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
