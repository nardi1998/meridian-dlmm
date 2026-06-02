export default function AgentStrip({ paused, agents = [] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {agents.map((agent) => (
        <div
          key={agent.name}
          className="flex items-center gap-2 rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-xs shadow-sm dark:shadow-none"
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              !paused && agent.status === "active" ? "bg-emerald-500" : "bg-zinc-400 dark:bg-zinc-600"
            }`}
          />
          <span className="font-medium text-foreground/90">{agent.name}</span>
          <span className="text-subtle">·</span>
          <span className="text-muted">{agent.role}</span>
          <span className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-muted">
            {agent.interval}
          </span>
        </div>
      ))}
    </div>
  );
}
