import { useCallback, useEffect, useRef, useState } from "react";
import { fetchDashboard } from "../api/client";
import { getMockDashboard } from "../data/mockData";

function getWsUrl() {
  const loc = window.location;
  const protocol = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${loc.hostname}${loc.port ? ":" + loc.port : ""}`;
}

export function useDashboard() {
  const [data, setData] = useState(() => getMockDashboard());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);

  const connectWs = useCallback(() => {
    if (wsRef.current) {
      try { wsRef.current.close(); } catch {}
    }

    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setLoading(false);
      console.log("[WS] connected");
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "update" && msg.data) {
          setData(msg.data);
          setError(null);
          setLoading(false);
        }
      } catch {}
    };

    ws.onclose = () => {
      setConnected(false);
      console.log("[WS] disconnected, reconnecting in 3s...");
      reconnectTimer.current = setTimeout(connectWs, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  // Initial HTTP fetch + WebSocket setup
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const initial = await fetchDashboard();
        if (!cancelled) {
          setData(initial);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      }
      // Connect WebSocket after initial fetch
      if (!cancelled) connectWs();
    }

    init();

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        try { wsRef.current.close(); } catch {}
      }
    };
  }, [connectWs]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchDashboard();
      setData(next);
    } catch (err) {
      setError(err.message);
      setData(getMockDashboard());
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, error, connected, refresh };
}
