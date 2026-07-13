/**
 * LiveAdapter — real HighLevel integration. Enabled with GHL_MODE=live.
 *
 * Returns the SAME normalized shapes as MockAdapter by mapping raw GHL payloads
 * in the `normalize*` helpers. Endpoints/headers below are grounded in the GHL
 * v2 ("LeadConnector") API (see docs/ARCHITECTURE.md §6 and docs/GHL-API.md):
 *
 *   Base URL          https://services.leadconnectorhq.com
 *   Voice AI agents   GET /voice-ai/agents                    Version: v3
 *   Voice AI calls    GET /voice-ai/dashboard/call-logs       Version: v3
 *   Transcription     GET /conversations/locations/{loc}/messages/{id}/transcription
 *                                                             Version: 2021-07-28
 *   Auth              Authorization: Bearer <OAuth token | PIT>
 *
 * NOTE ON RISK: HighLevel's Stoplight docs don't expose the transcript-segment
 * schema verbatim. The segment field names (speaker vs mediaChannel, text vs
 * transcript, startTime vs start) are our best reconstruction and MUST be
 * verified against a live response — which is exactly why parsing is isolated in
 * normalizeTranscript(). This is called out in the README's honesty matrix.
 */
const V3 = 'v3';
const V_CONV = '2021-07-28';

export class LiveAdapter {
  constructor(cfg) {
    this.cfg = cfg;
    this.locationId = cfg.locationId;
  }

  #headers(version) {
    return {
      Authorization: `Bearer ${this.cfg.accessToken}`,
      Version: version,
      Accept: 'application/json',
    };
  }

  async #get(path, { version = V_CONV, params = {} } = {}) {
    const url = new URL(this.cfg.apiBase + path);
    for (const [k, v] of Object.entries(params)) {
      if (v != null) url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, { headers: this.#headers(version) });
    if (!res.ok) {
      throw new Error(`GHL ${res.status} ${res.statusText} for ${path}`);
    }
    return res.json();
  }

  async listAgents() {
    const raw = await this.#get('/voice-ai/agents', {
      version: V3,
      params: { locationId: this.locationId },
    });
    return (raw.agents || raw.data || []).map(normalizeAgent);
  }

  async getAgent(agentId) {
    const raw = await this.#get(`/voice-ai/agents/${enc(agentId)}`, { version: V3 });
    return raw ? normalizeAgent(raw.agent || raw) : null;
  }

  async listCalls({ agentId } = {}) {
    const raw = await this.#get('/voice-ai/dashboard/call-logs', {
      version: V3,
      params: { locationId: this.locationId, agentId },
    });
    return (raw.callLogs || raw.data || []).map(normalizeCall);
  }

  async getCall(callId) {
    // Call logs don't embed transcripts; fetch the log then its transcription.
    const raw = await this.#get(`/voice-ai/dashboard/call-logs/${enc(callId)}`, { version: V3 });
    const call = normalizeCall(raw.callLog || raw);
    call.transcript = await this.getTranscript(call.messageId || callId);
    return call;
  }

  async getTranscript(messageId) {
    const raw = await this.#get(
      `/conversations/locations/${enc(this.locationId)}/messages/${enc(messageId)}/transcription`,
      { version: V_CONV }
    );
    return normalizeTranscript(messageId, raw);
  }
}

// Encode path segments so ids containing '/', '#', '?', spaces, etc. can't break
// the URL path or hit the wrong endpoint.
const enc = (v) => encodeURIComponent(String(v));

// ── raw GHL payload -> normalized shape ──
function normalizeAgent(a) {
  return {
    id: a.id || a._id,
    name: a.name || 'Unnamed agent',
    goal: a.goal || a.description || firstGoalName(a) || '',
    prompt: a.prompt?.systemPrompt || a.systemPrompt || a.prompt || a.script || '',
    tags: a.tags || [],
  };
}

function firstGoalName(a) {
  return Array.isArray(a.goals) && a.goals[0] ? a.goals[0].name : '';
}

function normalizeCall(c) {
  return {
    id: c.id || c._id || c.messageId,
    messageId: c.messageId || c.id,
    agentId: c.agentId || c.aiAgentId || '',
    contactId: c.contactId || '',
    direction: c.direction === 'outbound' ? 'outbound' : 'inbound',
    startedAt: c.startedAt || c.dateAdded || c.dateUpdated,
    durationSec: Number(c.callDuration || c.duration || 0),
    status: c.callStatus || c.status || 'completed',
    recordingUrl: c.recordingUrl || c.attachments?.[0] || undefined,
  };
}

// HIGHEST-RISK MAPPING — verify segment keys against a live response.
function normalizeTranscript(callId, raw) {
  const segments = raw.transcript || raw.segments || raw.messages || [];
  return {
    callId,
    turns: segments.map((s) => ({
      role: /agent|assistant|ai/i.test(String(s.speaker ?? s.role ?? s.mediaChannel))
        ? 'agent'
        : 'customer',
      text: s.text || s.transcript || '',
      startMs: Math.round((s.startTime ?? s.start ?? 0) * 1000),
      endMs: Math.round((s.endTime ?? s.end ?? 0) * 1000),
    })),
  };
}
