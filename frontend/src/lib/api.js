const API_BASE =
  (import.meta.env.VITE_API_BASE || "").trim() ||
  "https://carwash-backend-833921043838.us-central1.run.app";
async function parseJson(res) {
  return res.json().catch(() => ({}));
}

export async function apiGet(path) {
  const res = await fetch(API_BASE + path);
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error || `${res.status} ${res.statusText}`);
  return data;
}

export async function apiPost(path, body) {
  const res = await fetch(API_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error || `${res.status} ${res.statusText}`);
  return data;
}

export async function apiHistory(station, metric, rangeKey) {
  const qs = new URLSearchParams({ range: rangeKey || "12h" }).toString();
  return apiGet(`/api/history/${encodeURIComponent(station)}/${encodeURIComponent(metric)}?${qs}`);
}
