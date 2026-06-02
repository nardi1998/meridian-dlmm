import { useCallback, useEffect, useState } from "react";
import { fetchDashboard } from "../api/client";
import { getMockDashboard } from "../data/mockData";

export function useDashboard() {
  const [data, setData] = useState(() => getMockDashboard());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  return { data, loading, error, refresh };
}
