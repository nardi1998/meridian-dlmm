import { timeAgo } from "../utils/format";

const typeStyles = {
  deploy: { bg: "bg-blue-500/15", text: "text-blue-600 dark:text-blue-400", label: "Deploy" },
  close: { bg: "bg-red-500/15", text: "text-red-600 dark:text-red-400", label: "Close" },
  skip: { bg: "bg-zinc-400/15", text: "text-subtle", label: "Skip" },
  no_deploy: { bg: "bg-zinc-400/15", text: "text-subtle", label: "No deploy" },
  stay: { bg: "bg-zinc-400/15", text: "text-muted", label: "Stay" },
  claim: { bg: "bg-emerald-500/15", text: "text-emerald-600 dark:text-emerald-400", label: "Claim" },
  alert: { bg: "bg-amber-500/15", text: "text-amber-700 dark:text-amber-400", label: "Alert" },
};

export default function DecisionLog({ decisions = [] }) {
  return (
    <section className="rounded-xl border border-surface-border bg-surface-card shadow-sm dark:shadow-none">
      <div className="border-b border-surface-border px-4 py-3">
        <h2 className="text-sm font-medium text-foreground">Decision Log</h2>
        <p className="text-xs text-muted">Recent agent actions</p>
      </div>
      <ul className="max-h-[320px] divide-y divide-surface-border/60 overflow-y-auto scrollbar-thin">
        {decisions.map((d) => {
          const style = typeStyles[d.type] || typeStyles.stay;
          return (
            <li key={d.id} className="row-hover px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${style.bg} ${style.text}`}
                >
                  {style.label}
                </span>
                <span className="text-xs text-muted">{d.actor}</span>
                <span className="text-xs text-subtle">·</span>
                <span className="font-mono text-xs text-muted">{d.pool}</span>
                <span className="ml-auto text-xs text-subtle">{timeAgo(d.ts)}</span>
              </div>
              <p className="mt-1 text-sm font-medium text-foreground/90">{d.summary}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">{d.reason}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
