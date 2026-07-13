import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');

/**
 * MockAdapter — serves realistic sample data shaped exactly like the normalized
 * shapes the LiveAdapter would return. Lets the whole product run and demo with
 * zero HighLevel credentials.
 */
export class MockAdapter {
  constructor() {
    this.agents = readJson(join(DATA_DIR, 'agents.json'));
    this.calls = readJson(join(DATA_DIR, 'calls.json'));
    this.transcripts = loadTranscripts(join(DATA_DIR, 'transcripts'));
  }

  async listAgents() {
    return this.agents;
  }

  async getAgent(agentId) {
    return this.agents.find((a) => a.id === agentId) || null;
  }

  async listCalls({ agentId } = {}) {
    const calls = agentId ? this.calls.filter((c) => c.agentId === agentId) : this.calls;
    // list view omits the (heavy) transcript body
    return calls.map(({ ...c }) => c);
  }

  async getCall(callId) {
    const call = this.calls.find((c) => c.id === callId);
    if (!call) return null;
    return { ...call, transcript: this.transcripts[callId] || null };
  }

  async getTranscript(callId) {
    return this.transcripts[callId] || null;
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function loadTranscripts(dir) {
  const map = {};
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return map;
  }
  for (const f of files) {
    const t = readJson(join(dir, f));
    map[t.callId] = t;
  }
  return map;
}
