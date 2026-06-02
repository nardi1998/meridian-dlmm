const API_BASE = import.meta.env.VITE_API_URL || "";

export async function fetchDashboard() {
  const res = await fetch(`${API_BASE}/api/dashboard`);
  if (!res.ok) throw new Error(`Dashboard API ${res.status}`);
  return res.json();
}
