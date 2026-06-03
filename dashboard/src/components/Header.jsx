import ThemeToggle from "./ThemeToggle";

export default function Header({
  paused,
  onTogglePause,
  source,
  dryRun,
  onRefresh,
  loading,
  lastCycle,
  connected,
}) {
  const running = !paused;

  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-surface-border bg-surface-raised/80 px-6 py-4 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400">
          <span className="text-sm font-bold text-white">M</span>
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">Meridian</h1>
          <p className="text-xs text-muted">
            Autonomous DLMM LP Agent
            {source === "live" && (
              <span className="ml-2 text-emerald-500/80">· live</span>
            )}
            {connected !== undefined && (
              <span className={`ml-2 ${connected ? "text-emerald-500/80" : "text-red-500/80"}`}>
                · {connected ? "WS connected" : "WS offline"}
              </span>
            )}
            {dryRun && <span className="ml-2 text-amber-500/80">· DRY RUN</span>}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        {lastCycle && (
          <div className="hidden items-center gap-2 text-xs text-muted sm:flex">
            <span>Terakhir update</span>
            <span className="font-mono text-subtle">{lastCycle}</span>
          </div>
        )}

        <ThemeToggle />

        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="rounded-lg border border-surface-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-foreground/[0.06] disabled:opacity-50"
          >
            {loading ? "Memuat…" : "Refresh"}
          </button>
        )}

        <button
          type="button"
          onClick={onTogglePause}
          className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
            running
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
              : "border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${running ? "animate-pulse bg-emerald-400" : "bg-amber-400"}`}
          />
          {running ? "Running" : "Paused"}
        </button>
      </div>
    </header>
  );
}
