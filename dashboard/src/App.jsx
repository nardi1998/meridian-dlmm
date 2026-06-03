import { useState } from "react";
import Header from "./components/Header";
import Overview from "./components/Overview";
import ActivePositions from "./components/ActivePositions";
import ClosedPositions from "./components/ClosedPositions";
import Opportunities from "./components/Opportunities";
import DecisionLog from "./components/DecisionLog";
import Charts from "./components/Charts";
import AgentStrip from "./components/AgentStrip";
import { useDashboard } from "./hooks/useDashboard";

export default function App() {
  const [paused, setPaused] = useState(false);
  const { data, loading, error, connected, refresh } = useDashboard();

  return (
    <div className="min-h-screen bg-surface">
      <Header
        paused={paused}
        onTogglePause={() => setPaused((p) => !p)}
        source={data.source}
        dryRun={data.dryRun}
        onRefresh={refresh}
        loading={loading}
        lastCycle={data.agentStatus?.lastCycle}
        connected={connected}
      />

      {error && (
        <p className="mx-auto max-w-7xl px-4 pt-2 text-xs text-amber-500 sm:px-6">
          API tidak tersedia ({error}) — menampilkan data mock. Jalankan{" "}
          <code className="text-subtle">node dashboard/server.js</code>
        </p>
      )}

      {data.liveError && data.source === "mock" && (
        <p className="mx-auto max-w-7xl px-4 pt-2 text-xs text-muted sm:px-6">
          Live: {data.liveError}
        </p>
      )}

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <Overview
          overview={data.overview}
          paused={paused}
          solPrice={data.solPrice}
          source={data.source}
        />
        <AgentStrip paused={paused} agents={data.agentStatus?.agents} />

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <ActivePositions positions={data.positions} />
            <ClosedPositions positions={data.closedPositions} />
            <Charts
              portfolioHistory={data.portfolioHistory}
              profitHistory={data.profitHistory}
            />
          </div>
          <div className="space-y-6">
            <Opportunities opportunities={data.opportunities} />
            <DecisionLog decisions={data.decisions} />
          </div>
        </div>
      </main>

      <footer className="border-t border-surface-border py-4 text-center text-xs text-subtle">
        Meridian · Dashboard SOL · Meteora DLMM on Solana
        {data.source === "live" && " · data live"}
      </footer>
    </div>
  );
}
