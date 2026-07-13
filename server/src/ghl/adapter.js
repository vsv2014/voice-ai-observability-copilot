import { config } from '../config.js';
import { MockAdapter } from './mockAdapter.js';
import { LiveAdapter } from './liveAdapter.js';

/**
 * GHL Adapter — the single seam between the Copilot and HighLevel.
 *
 * Every implementation returns the SAME normalized shapes (see ./shapes.js) so
 * nothing downstream (criteria engine, analyzer, UI) knows or cares whether the
 * data came from real HighLevel APIs or the local mock dataset.
 *
 * Interface:
 *   listAgents()            -> VoiceAgent[]
 *   getAgent(agentId)       -> VoiceAgent | null
 *   listCalls({ agentId? }) -> Call[]        (without transcript body)
 *   getCall(callId)         -> Call | null   (with transcript)
 *   getTranscript(callId)   -> Transcript | null
 */
export function createGhlAdapter() {
  if (config.ghl.mode === 'live') return new LiveAdapter(config.ghl);
  return new MockAdapter();
}

export const ghl = createGhlAdapter();
