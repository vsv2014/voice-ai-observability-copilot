/**
 * Tiny in-memory store. Holds the analysis results the engine produces so the
 * dashboard can read aggregates without re-scoring on every request.
 *
 * Source-of-truth for agents/calls/transcripts is the GHL adapter; this store
 * only caches derived analysis (findings, recommendations, run metadata).
 */
const state = {
  analysisByCallId: new Map(), // callId -> { callId, agentId, findings[], scoredAt }
  recommendationsByAgentId: new Map(), // agentId -> Recommendation[]
  lastRunAt: null,
};

export const store = {
  putCallAnalysis(analysis) {
    state.analysisByCallId.set(analysis.callId, analysis);
  },
  getCallAnalysis(callId) {
    return state.analysisByCallId.get(callId) || null;
  },
  getAnalysesForAgent(agentId) {
    return [...state.analysisByCallId.values()].filter((a) => a.agentId === agentId);
  },
  allAnalyses() {
    return [...state.analysisByCallId.values()];
  },
  putRecommendations(agentId, recs) {
    state.recommendationsByAgentId.set(agentId, recs);
  },
  getRecommendations(agentId) {
    return state.recommendationsByAgentId.get(agentId) || [];
  },
  allRecommendations() {
    return [...state.recommendationsByAgentId.values()].flat();
  },
  markRun() {
    state.lastRunAt = new Date().toISOString();
  },
  get lastRunAt() {
    return state.lastRunAt;
  },
  reset() {
    state.analysisByCallId.clear();
    state.recommendationsByAgentId.clear();
    state.lastRunAt = null;
  },
};
