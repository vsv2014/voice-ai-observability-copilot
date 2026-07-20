// API client.
//
// When a live backend is present (local dev, or a full server deploy), it uses
// /api. When the app is hosted as a STATIC site with no backend (e.g. Vercel),
// it transparently falls back to the pre-computed snapshot in /public/data,
// so the full dashboard still works from a single link.
const STATIC_BASE = `${import.meta.env.BASE_URL}data`;

async function get(apiPath, staticFile) {
  try {
    const r = await fetch(apiPath, { headers: { Accept: 'application/json' } });
    const ct = r.headers.get('content-type') || '';
    if (r.ok && ct.includes('application/json')) return await r.json();
  } catch {
    /* backend unavailable — fall through to the static snapshot */
  }
  const s = await fetch(`${STATIC_BASE}/${staticFile}`);
  if (!s.ok) throw new Error(`${s.status} ${s.statusText}`);
  return s.json();
}

export const api = {
  health: () => get('/api/health', 'health.json'),
  overview: () => get('/api/overview', 'overview.json'),
  agents: () => get('/api/agents', 'agents.json'),
  agent: (id) => get(`/api/agents/${id}`, `agent-${id}.json`),
  agentCalls: (id) => get(`/api/agents/${id}/calls`, `agent-${id}-calls.json`),
  call: (callId) => get(`/api/calls/${callId}`, `call-${callId}.json`),
  recommendations: () => get('/api/recommendations', 'recommendations.json'),
  useActions: (agentId) =>
    get(
      `/api/use-actions${agentId ? `?agentId=${agentId}` : ''}`,
      agentId ? `use-actions-${agentId}.json` : 'use-actions.json'
    ),

  // On a static deploy there is no backend to re-run; the data is pre-computed.
  analyze: async (agentId) => {
    try {
      const r = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agentId ? { agentId } : {}),
      });
      const ct = r.headers.get('content-type') || '';
      if (r.ok && ct.includes('application/json')) return await r.json();
    } catch {
      /* static deploy — no-op */
    }
    return { static: true };
  },
};
