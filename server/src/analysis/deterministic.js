/**
 * Deterministic analyzer — the zero-key default engine.
 *
 * Evaluates a call transcript against an agent's criteria using transparent,
 * testable rules. Emits the same Finding shape the LLM analyzer does, so the
 * dashboard and flywheel logic are engine-agnostic.
 *
 * @typedef {Object} Finding
 * @property {string} callId
 * @property {string} criterionId
 * @property {string} label
 * @property {'pass'|'fail'|'missed'} status
 * @property {'low'|'medium'|'high'} severity
 * @property {number|null} turnIndex   the turn that satisfied/should have satisfied it
 * @property {string} evidence         quoted transcript snippet (or "" if none)
 * @property {string} explanation
 */

const matches = (text, keywords) => {
  const t = (text || '').toLowerCase();
  return (keywords || []).some((k) => t.includes(k.toLowerCase()));
};

/** Evaluate a single criterion against a transcript -> Finding. */
export function evaluateCriterion(call, transcript, criterion) {
  const turns = transcript?.turns || [];
  const agentTurns = turns.map((t, i) => ({ ...t, i })).filter((t) => t.role === 'agent');
  const customerTurns = turns.map((t, i) => ({ ...t, i })).filter((t) => t.role === 'customer');
  const { detector } = criterion;

  const base = {
    callId: call.id,
    criterionId: criterion.id,
    label: criterion.label,
    severity: criterion.severity,
    turnIndex: null,
    evidence: '',
  };

  switch (detector.kind) {
    case 'agent_says': {
      const hit = agentTurns.find((t) => matches(t.text, detector.keywords));
      return hit
        ? { ...base, status: 'pass', turnIndex: hit.i, evidence: hit.text, explanation: 'Required step present.' }
        : { ...base, status: 'fail', explanation: 'Agent never performed this required step.' };
    }
    case 'agent_avoids': {
      const hit = agentTurns.find((t) => matches(t.text, detector.keywords));
      return hit
        ? { ...base, status: 'fail', turnIndex: hit.i, evidence: hit.text, explanation: 'Agent used compliance-risky language.' }
        : { ...base, status: 'pass', explanation: 'No risky language detected.' };
    }
    case 'question_asked': {
      const hit = agentTurns.find((t) => t.text.includes('?') && matches(t.text, detector.keywords));
      return hit
        ? { ...base, status: 'pass', turnIndex: hit.i, evidence: hit.text, explanation: 'Qualifying question asked.' }
        : { ...base, status: 'missed', explanation: 'No qualifying question was asked — missed opportunity.' };
    }
    case 'customer_confirms': {
      const hit = customerTurns.find((t) => matches(t.text, detector.keywords));
      return hit
        ? { ...base, status: 'pass', turnIndex: hit.i, evidence: hit.text, explanation: 'Customer confirmed — goal reached.' }
        : { ...base, status: 'missed', explanation: 'Customer never confirmed — goal not reached.' };
    }
    case 'outcome_keyword': {
      const hit = turns.map((t, i) => ({ ...t, i })).find((t) => matches(t.text, detector.keywords));
      return hit
        ? { ...base, status: 'pass', turnIndex: hit.i, evidence: hit.text, explanation: 'Desired outcome detected.' }
        : { ...base, status: 'missed', explanation: 'Desired outcome not detected.' };
    }
    default:
      return { ...base, status: 'missed', explanation: `Unknown detector "${detector.kind}".` };
  }
}

/** Score = weighted fraction of criteria passed, 0..100. */
export function scoreCall(findings, criteria) {
  const byId = new Map(criteria.map((c) => [c.id, c]));
  let earned = 0;
  let total = 0;
  for (const f of findings) {
    const c = byId.get(f.criterionId);
    if (!c) continue;
    total += c.weight;
    if (f.status === 'pass') earned += c.weight;
  }
  return total ? Math.round((earned / total) * 100) : 100;
}

/**
 * Analyze one call against its criteria (deterministic).
 * @returns {{callId, agentId, score, findings: Finding[], engine: string, scoredAt: string}}
 */
export function analyzeCallDeterministic(call, transcript, criteria) {
  const findings = criteria.map((c) => evaluateCriterion(call, transcript, c));
  return {
    callId: call.id,
    agentId: call.agentId,
    score: scoreCall(findings, criteria),
    findings,
    engine: 'deterministic',
    scoredAt: new Date().toISOString(),
  };
}
