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

// Negation cues that flip the meaning of a nearby keyword ("can't guarantee",
// "not sure"). We scan a few tokens before the match.
const NEGATORS = new Set([
  'not', 'no', 'never', 'cannot', 'without', 'wont', 'dont', 'cant',
  "won't", "don't", "can't", "cannot", "doesn't", "didn't", "isn't",
  "aren't", "wouldn't", "shouldn't",
]);

/**
 * Find `keyword` in `text` as a whole token (not embedded in a larger word, so
 * "yes" no longer matches "yesterday"). Returns the match index or -1.
 */
function findKeyword(text, keyword) {
  const isAlnum = (ch) => ch >= 'a' && ch <= 'z' ? true : ch >= '0' && ch <= '9';
  let from = 0;
  while (from <= text.length) {
    const idx = text.indexOf(keyword, from);
    if (idx === -1) return -1;
    const before = idx === 0 ? '' : text[idx - 1];
    const after = idx + keyword.length >= text.length ? '' : text[idx + keyword.length];
    // A boundary holds if the adjacent char isn't alphanumeric, OR the keyword's
    // own edge char isn't alphanumeric (e.g. "100%").
    const okBefore = !isAlnum(before) || !isAlnum(keyword[0]);
    const okAfter = !isAlnum(after) || !isAlnum(keyword[keyword.length - 1]);
    if (okBefore && okAfter) return idx;
    from = idx + 1;
  }
  return -1;
}

/** True if a negation cue appears within the ~4 tokens preceding `idx`. */
function negatedBefore(text, idx) {
  const preceding = text.slice(0, idx).split(/[^a-z']+/).filter(Boolean).slice(-4);
  return preceding.some((w) => NEGATORS.has(w) || w.endsWith("n't"));
}

/**
 * Look for any keyword in `text` as a whole, non-negated token.
 * @returns {{ index:number }|null}
 */
function matchKeyword(text, keywords) {
  const t = (text || '').toLowerCase();
  for (const raw of keywords || []) {
    const k = raw.toLowerCase();
    const idx = findKeyword(t, k);
    if (idx !== -1 && !negatedBefore(t, idx)) return { index: idx };
  }
  return null;
}

/** Evaluate a single criterion against a transcript -> Finding. */
export function evaluateCriterion(call, transcript, criterion) {
  const turns = transcript?.turns || [];
  const agentTurns = turns.map((t, i) => ({ ...t, i })).filter((t) => t.role === 'agent');
  const customerTurns = turns.map((t, i) => ({ ...t, i })).filter((t) => t.role === 'customer');
  const detector = criterion.detector || {};

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
      const hit = agentTurns.find((t) => matchKeyword(t.text, detector.keywords));
      return hit
        ? { ...base, status: 'pass', turnIndex: hit.i, evidence: hit.text, explanation: 'Required step present.' }
        : { ...base, status: 'fail', explanation: 'Agent never performed this required step.' };
    }
    case 'agent_avoids': {
      // A negated mention ("I can't guarantee…") is compliant, so matchKeyword
      // (which ignores negated hits) correctly does NOT flag it.
      const hit = agentTurns.find((t) => matchKeyword(t.text, detector.keywords));
      return hit
        ? { ...base, status: 'fail', turnIndex: hit.i, evidence: hit.text, explanation: 'Agent used compliance-risky language.' }
        : { ...base, status: 'pass', explanation: 'No risky language detected.' };
    }
    case 'question_asked': {
      const hit = agentTurns.find((t) => (t.text || '').includes('?') && matchKeyword(t.text, detector.keywords));
      return hit
        ? { ...base, status: 'pass', turnIndex: hit.i, evidence: hit.text, explanation: 'Qualifying question asked.' }
        : { ...base, status: 'missed', explanation: 'No qualifying question was asked — missed opportunity.' };
    }
    case 'customer_confirms': {
      // Ignores negated hits, so "I'm not sure" no longer counts as confirming.
      const hit = customerTurns.find((t) => matchKeyword(t.text, detector.keywords));
      return hit
        ? { ...base, status: 'pass', turnIndex: hit.i, evidence: hit.text, explanation: 'Customer confirmed — goal reached.' }
        : { ...base, status: 'missed', explanation: 'Customer never confirmed — goal not reached.' };
    }
    case 'outcome_keyword': {
      const hit = turns.map((t, i) => ({ ...t, i })).find((t) => matchKeyword(t.text, detector.keywords));
      return hit
        ? { ...base, status: 'pass', turnIndex: hit.i, evidence: hit.text, explanation: 'Desired outcome detected.' }
        : { ...base, status: 'missed', explanation: 'Desired outcome not detected.' };
    }
    default:
      return { ...base, status: 'missed', explanation: `Unknown detector "${detector.kind}".` };
  }
}

/**
 * Score = weighted fraction of criteria passed, 0..100.
 * Returns null (not 100) when there is nothing scorable, so an agent with no
 * working criteria reads as "not scored" rather than a perfect performer.
 */
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
  return total > 0 ? Math.round((earned / total) * 100) : null;
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
