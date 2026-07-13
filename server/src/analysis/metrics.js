import { store } from '../store/store.js';
import { criteriaForAgent } from './criteria.js';

/** Account-level rollup for the dashboard landing view. */
export function accountOverview(agents, criteria) {
  const perAgent = agents.map((a) => agentSummary(a, criteria));
  const allAnalyses = store.allAnalyses();
  const scored = allAnalyses.length;
  const avgScore = scored
    ? Math.round(allAnalyses.reduce((s, a) => s + a.score, 0) / scored)
    : null;

  const openIssues = allAnalyses.reduce(
    (s, a) => s + a.findings.filter((f) => f.status !== 'pass').length,
    0
  );
  const useActions = allAnalyses.reduce(
    (s, a) => s + a.findings.filter((f) => f.status !== 'pass' && f.severity === 'high').length,
    0
  );

  return {
    lastRunAt: store.lastRunAt,
    totals: { agents: agents.length, callsScored: scored, avgScore, openIssues, useActions },
    agents: perAgent.sort((a, b) => (a.avgScore ?? 100) - (b.avgScore ?? 100)),
    recommendations: store.allRecommendations().length,
  };
}

/** Per-agent summary: score, top failing criteria, counts. */
export function agentSummary(agent, criteria) {
  const analyses = store.getAnalysesForAgent(agent.id);
  const agentCriteria = criteriaForAgent(agent.id, criteria);
  const scored = analyses.length;
  const avgScore = scored ? Math.round(analyses.reduce((s, a) => s + a.score, 0) / scored) : null;

  // failure rate per criterion
  const byCriterion = agentCriteria.map((c) => {
    let fails = 0;
    for (const a of analyses) {
      const f = a.findings.find((x) => x.criterionId === c.id);
      if (f && f.status !== 'pass') fails += 1;
    }
    return {
      criterionId: c.id,
      label: c.label,
      type: c.type,
      severity: c.severity,
      failRate: scored ? Math.round((fails / scored) * 100) : 0,
      failCount: fails,
    };
  });

  const highSeverityOpen = analyses.reduce(
    (s, a) => s + a.findings.filter((f) => f.status !== 'pass' && f.severity === 'high').length,
    0
  );

  return {
    id: agent.id,
    name: agent.name,
    goal: agent.goal,
    callsScored: scored,
    avgScore,
    highSeverityOpen,
    topFailures: byCriterion.filter((c) => c.failCount > 0).sort((a, b) => b.failRate - a.failRate),
    recommendations: store.getRecommendations(agent.id).length,
  };
}

/** "Use Actions": specific call segments that need a human, ranked by severity. */
export function useActions(agentId) {
  const analyses = agentId ? store.getAnalysesForAgent(agentId) : store.allAnalyses();
  const rank = { high: 0, medium: 1, low: 2 };
  const actions = [];
  for (const a of analyses) {
    for (const f of a.findings) {
      if (f.status === 'pass') continue;
      actions.push({
        callId: a.callId,
        agentId: a.agentId,
        criterionId: f.criterionId,
        label: f.label,
        status: f.status,
        severity: f.severity,
        turnIndex: f.turnIndex,
        evidence: f.evidence,
        explanation: f.explanation,
      });
    }
  }
  return actions.sort((x, y) => rank[x.severity] - rank[y.severity]);
}
