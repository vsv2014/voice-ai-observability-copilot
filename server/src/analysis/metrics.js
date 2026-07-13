import { store } from '../store/store.js';
import { criteriaForAgent } from './criteria.js';
import { isOpen, isHighSeverityOpen } from './status.js';

/** Mean of the numeric scores in `analyses`, or null if none are scored. */
function avgOf(analyses) {
  const scores = analyses.map((a) => a.score).filter((s) => typeof s === 'number');
  return scores.length ? Math.round(scores.reduce((s, n) => s + n, 0) / scores.length) : null;
}

const countFindings = (analyses, pred) =>
  analyses.reduce((s, a) => s + a.findings.filter(pred).length, 0);

/** Account-level rollup for the dashboard landing view. */
export function accountOverview(agents, criteria) {
  const perAgent = agents.map((a) => agentSummary(a, criteria));
  const allAnalyses = store.allAnalyses();

  return {
    lastRunAt: store.lastRunAt,
    totals: {
      agents: agents.length,
      callsScored: allAnalyses.length,
      avgScore: avgOf(allAnalyses),
      openIssues: countFindings(allAnalyses, isOpen),
      useActions: countFindings(allAnalyses, isHighSeverityOpen),
    },
    // Worst (lowest score) first; unscored agents sort to the end.
    agents: perAgent.sort((a, b) => (a.avgScore ?? Infinity) - (b.avgScore ?? Infinity)),
    recommendations: store.allRecommendations().length,
  };
}

/** Per-agent summary: score, top failing criteria, counts. */
export function agentSummary(agent, criteria) {
  const analyses = store.getAnalysesForAgent(agent.id);
  const agentCriteria = criteriaForAgent(agent.id, criteria);
  const scored = analyses.length;

  const byCriterion = agentCriteria.map((c) => {
    const fails = analyses.filter((a) => {
      const f = a.findings.find((x) => x.criterionId === c.id);
      return f && isOpen(f);
    }).length;
    return {
      criterionId: c.id,
      label: c.label,
      type: c.type,
      severity: c.severity,
      failRate: scored ? Math.round((fails / scored) * 100) : 0,
      failCount: fails,
    };
  });

  return {
    id: agent.id,
    name: agent.name,
    goal: agent.goal,
    callsScored: scored,
    avgScore: avgOf(analyses),
    highSeverityOpen: countFindings(analyses, isHighSeverityOpen),
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
      if (!isOpen(f)) continue;
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
