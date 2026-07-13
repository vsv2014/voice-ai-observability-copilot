// Thin API client for the Copilot backend. Base is relative so it works both in
// dev (Vite proxy) and when embedded/served by the backend.
const BASE = '/api';

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export const api = {
  health: () => req('/health'),
  overview: () => req('/overview'),
  agents: () => req('/agents'),
  agent: (id) => req(`/agents/${id}`),
  agentCalls: (id) => req(`/agents/${id}/calls`),
  call: (callId) => req(`/calls/${callId}`),
  recommendations: () => req('/recommendations'),
  useActions: (agentId) => req(`/use-actions${agentId ? `?agentId=${agentId}` : ''}`),
  analyze: (agentId) =>
    req('/analyze', { method: 'POST', body: JSON.stringify(agentId ? { agentId } : {}) }),
};
