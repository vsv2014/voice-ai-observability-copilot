// API client.
//
// When a live backend is present (local dev, or a full server deploy), it uses
// /api. When the app is hosted as a STATIC site with no backend (e.g. Vercel),
// it transparently falls back to the pre-computed snapshot in /public/data,
// so the full dashboard still works from a single link.
const STATIC_BASE = `${import.meta.env.BASE_URL}data`;

// Which source actually answered the last request. The footer reports this, so a
// backend-less deploy can't claim "Backend connected" over precomputed JSON.
let lastSource = 'backend';
export const dataSource = () => lastSource;

async function get(apiPath, staticFile) {
  try {
    const r = await fetch(apiPath, { headers: { Accept: 'application/json' } });
    const ct = r.headers.get('content-type') || '';
    if (r.ok && ct.includes('application/json')) {
      lastSource = 'backend';
      return await r.json();
    }
  } catch {
    /* backend unavailable — fall through to the static snapshot */
  }
  const s = await fetch(`${STATIC_BASE}/${staticFile}`);
  if (!s.ok) throw new Error(`${s.status} ${s.statusText}`);
  lastSource = 'snapshot';
  return s.json();
}

const enc = encodeURIComponent;

const NO_BACKEND =
  "Couldn't reach the backend. Testing or saving a prompt needs the running server — " +
  'the static snapshot deploy has no API.';

/**
 * POST/PUT against the API.
 *
 * Unlike `get()` there is no snapshot to fall back to: a write or a prompt test only
 * means something against a live backend. The one subtlety is telling "the API said no"
 * apart from "there is no API here" — a static host answers `/api/*` with its own error
 * page, and Vercel's is JSON whose `error` is an OBJECT, so passing it to `new Error()`
 * rendered a literal "[object Object]" in the UI. Our API always replies with a STRING
 * `error`, so anything else on a failure is the host talking, not the server.
 */
async function send(method, apiPath, body) {
  let res;
  try {
    res = await fetch(apiPath, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(NO_BACKEND);
  }

  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : NO_BACKEND);
  }
  if (!data) throw new Error(NO_BACKEND);
  return data;
}

export const api = {
  // `source` tells the UI whether this came from a live backend or the static snapshot.
  health: async () => ({ ...(await get('/api/health', 'health.json')), source: lastSource }),
  overview: () => get('/api/overview', 'overview.json'),
  agents: () => get('/api/agents', 'agents.json'),
  agent: (id) => get(`/api/agents/${enc(id)}`, `agent-${id}.json`),
  agentCalls: (id) => get(`/api/agents/${enc(id)}/calls`, `agent-${id}-calls.json`),
  call: (callId) => get(`/api/calls/${enc(callId)}`, `call-${callId}.json`),
  recommendations: () => get('/api/recommendations', 'recommendations.json'),
  useActions: (agentId) =>
    get(
      `/api/use-actions${agentId ? `?agentId=${enc(agentId)}` : ''}`,
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

  savePrompt: (agentId, prompt) => send('PUT', `/api/agents/${enc(agentId)}/prompt`, { prompt }),

  testPrompt: (agentId, prompt) =>
    send('POST', `/api/agents/${enc(agentId)}/test-prompt`, { prompt }),
};
