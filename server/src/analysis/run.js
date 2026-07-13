import { ghl } from '../ghl/adapter.js';
import { store } from '../store/store.js';
import { loadCriteria, criteriaForAgent } from './criteria.js';
import { analyzeCallDeterministic } from './deterministic.js';
import { generateRecommendations } from './recommend.js';

/**
 * The Monitor + Analyze pipeline (the "Validation Flywheel" run).
 *
 *   ingest calls  ->  score each vs criteria  ->  store findings
 *                 ->  aggregate per agent      ->  generate recommendations
 *
 * Idempotent: re-running re-scores everything with the current criteria.
 */
export async function runAnalysis({ agentId } = {}) {
  const agents = await ghl.listAgents();
  const criteria = loadCriteria(agents);
  const targetAgents = agentId ? agents.filter((a) => a.id === agentId) : agents;

  let callsScored = 0;

  for (const agent of targetAgents) {
    const agentCriteria = criteriaForAgent(agent.id, criteria);
    const calls = await ghl.listCalls({ agentId: agent.id });

    for (const listCall of calls) {
      const call = await ghl.getCall(listCall.id);
      if (!call) continue;
      const analysis = analyzeCallDeterministic(call, call.transcript, agentCriteria);
      store.putCallAnalysis(analysis);
      callsScored += 1;
    }

    const analyses = store.getAnalysesForAgent(agent.id);
    const recs = await generateRecommendations(agent, agentCriteria, analyses);
    store.putRecommendations(agent.id, recs);
  }

  store.markRun();
  return { agents: targetAgents.length, callsScored, ranAt: store.lastRunAt };
}
