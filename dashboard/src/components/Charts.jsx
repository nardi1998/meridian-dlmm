import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTheme } from "../context/ThemeContext";
import { formatSol } from "../utils/format";

function SolChartTooltip({ active, payload, label, valueKey = "valueSol" }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  const val = point?.[valueKey] ?? payload[0]?.value;
  return (
    <div className="rounded-lg border border-surface-border bg-surface-raised px-3 py-2 shadow-xl">
      <p className="text-xs text-muted">{label}</p>
      <p className="font-mono text-sm font-semibold text-foreground">{formatSol(val)}</p>
    </div>
  );
}

export default function Charts({ portfolioHistory = [], profitHistory = [] }) {
  const { isDark } = useTheme();
  const gridStroke = isDark ? "rgb(37, 42, 53)" : "rgb(226, 232, 240)";
  const tickFill = isDark ? "#71717a" : "#94a3b8";

  const portfolio = portfolioHistory.map((row) => ({
    date: row.date,
    valueSol: row.valueSol ?? row.value,
  }));

  const profit = profitHistory.map((row) => ({
    date: row.date,
    cumulativeSol: row.cumulativeSol ?? row.cumulative,
    dailySol: row.dailySol ?? row.daily,
  }));

  const latestPortfolio = portfolio[portfolio.length - 1]?.valueSol;

  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-surface-border bg-surface-card p-4">
        <h3 className="text-sm font-medium text-foreground">Nilai portofolio</h3>
        <p className="mb-4 text-xs text-muted">Tren saldo 30 hari (SOL)</p>
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={portfolio} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="portfolioGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: tickFill, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: tickFill, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${v} ◎`}
                width={48}
              />
              <Tooltip content={<SolChartTooltip valueKey="valueSol" />} />
              <Area
                type="monotone"
                dataKey="valueSol"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="url(#portfolioGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-right font-mono text-xs text-muted">
          Saat ini {formatSol(latestPortfolio)}
        </p>
      </div>

      <div className="rounded-xl border border-surface-border bg-surface-card p-4">
        <h3 className="text-sm font-medium text-foreground">Profit</h3>
        <p className="mb-4 text-xs text-muted">PnL kumulatif & fee harian (SOL)</p>
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={profit} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: tickFill, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: tickFill, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${v}◎`}
                width={44}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0]?.payload;
                  return (
                    <div className="rounded-lg border border-surface-border bg-surface-raised px-3 py-2 shadow-xl">
                      <p className="text-xs text-muted">{label}</p>
                      <p className="font-mono text-xs text-emerald-500 dark:text-emerald-400">
                        Fee: {formatSol(p?.dailySol)}
                      </p>
                      <p className="font-mono text-xs text-violet-600 dark:text-violet-300">
                        PnL kum.: {formatSol(p?.cumulativeSol)}
                      </p>
                    </div>
                  );
                }}
              />
              <Bar dataKey="dailySol" fill="#22c55e" fillOpacity={0.5} radius={[2, 2, 0, 0]} />
              <Line
                type="monotone"
                dataKey="cumulativeSol"
                stroke="#8b5cf6"
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex justify-end gap-4 text-xs">
          <span className="flex items-center gap-1.5 text-muted">
            <span className="h-2 w-2 rounded-sm bg-emerald-500/50" /> Fee harian
          </span>
          <span className="flex items-center gap-1.5 text-muted">
            <span className="h-0.5 w-3 bg-violet-500 dark:bg-violet-400" /> PnL kumulatif
          </span>
        </div>
      </div>
    </section>
  );
}
