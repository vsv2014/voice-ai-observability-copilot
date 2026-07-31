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

import { gateScore, isGatingSeverity } from './severity.js';

// ── Keyword matching ────────────────────────────────────────────────────
// Detectors look for keywords in a turn's text. Four small rules keep the matches
// honest. Each is ONE named function below, so any wrong verdict traces to one rule:
//
//   findKeywordAll   whole word, every occurrence — "yes" ≠ "yesterday", and a negated
//                    mention can't mask a real one later in the same turn
//   negatedBefore    negation, current clause only — "I can't guarantee…" is compliant,
//                    but "No, I guarantee it" is still a violation
//   insideQuestion   the keyword is part of a question — "Can you confirm the price?"
//                    is the customer asking, not agreeing
//   DECLINE_OPENER   the turn opens by refusing — "No thanks, I'm okay" declines
//
// matchKeyword() always applies the first two; a caller opts into the third by passing
// it as `reject`. isConfirmation() is the single place all four combine.
// ─────────────────────────────────────────────────────────────────────────

/** Negation cues that flip a nearby keyword ("can't guarantee", "not sure"). */
const NEGATORS = new Set([
  'not', 'no', 'never', 'cannot', 'without', 'wont', 'dont', 'cant',
  "won't", "don't", "can't", "cannot", "doesn't", "didn't", "isn't",
  "aren't", "wouldn't", "shouldn't",
]);

// Clause boundary — one vocabulary, used for BOTH negation scope and question scope.
// Deliberately not /g: `split` ignores the flag, and `test` would carry lastIndex state.
const CLAUSE_BREAK = /[,;:.!?—–-]|\bbut\b|\bhowever\b|\bthough\b/;

/** A turn that opens by refusing. ("No problem"/"No worries" are affirmative idioms.) */
const DECLINE_OPENER = /^(?:no|nope|nah|not)\b(?!\s+(?:problem|worries))/;

/**
 * Every occurrence of `keyword` in `text` as a whole token (not embedded in a larger
 * word, so "yes" no longer matches "yesterday"), as ascending indices.
 */
function* findKeywordAll(text, keyword) {
  const isAlnum = (ch) => (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9');
  let from = 0;
  while (from <= text.length) {
    const idx = text.indexOf(keyword, from);
    if (idx === -1) return;
    const before = idx === 0 ? '' : text[idx - 1];
    const after = idx + keyword.length >= text.length ? '' : text[idx + keyword.length];
    // A boundary holds if the adjacent char isn't alphanumeric, OR the keyword's
    // own edge char isn't alphanumeric (e.g. "100%").
    const okBefore = !isAlnum(before) || !isAlnum(keyword[0]);
    const okAfter = !isAlnum(after) || !isAlnum(keyword[keyword.length - 1]);
    if (okBefore && okAfter) yield idx;
    from = idx + 1;
  }
}

/**
 * True if a negation cue appears in the ~4 tokens before `idx`, within the same clause.
 *
 * Clause scope is what stops a negator in an EARLIER clause from excusing a real
 * violation: "No, I guarantee it" and "Not only that, I guarantee 40%" are both flagged,
 * while "I can't guarantee savings" stays compliant.
 */
function negatedBefore(text, idx) {
  const clause = text.slice(0, idx).split(CLAUSE_BREAK).pop();
  const words = clause.split(/[^a-z']+/).filter(Boolean).slice(-4);
  return words.some((w) => NEGATORS.has(w) || w.endsWith("n't"));
}

/**
 * True if the keyword at `idx` is part of a question: a '?' follows it with no clause
 * boundary in between.
 *
 * That one test separates "Can you confirm the price?" (the keyword belongs to the
 * question — not a confirmation) from "Yes, that works — can we do 3pm?" (the keyword is
 * in an earlier clause, so the trailing question doesn't undo the agreement).
 */
function insideQuestion(text, idx) {
  const q = text.indexOf('?', idx);
  return q !== -1 && !CLAUSE_BREAK.test(text.slice(idx, q));
}

/**
 * First whole-word, non-negated occurrence of any keyword.
 * @param {(text:string, idx:number)=>boolean} [reject] optional extra veto per match
 * @returns {{ index:number }|null}
 */
function matchKeyword(text, keywords, reject) {
  const t = (text || '').toLowerCase();
  for (const raw of keywords || []) {
    for (const idx of findKeywordAll(t, raw.toLowerCase())) {
      if (negatedBefore(t, idx)) continue;
      if (reject?.(t, idx)) continue;
      return { index: idx };
    }
  }
  return null;
}

/** A customer turn is agreement only if it neither refuses nor merely asks. */
function isConfirmation(text, keywords) {
  if (DECLINE_OPENER.test((text || '').toLowerCase().trim())) return false;
  return matchKeyword(text, keywords, insideQuestion) !== null;
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
      const hit = customerTurns.find((t) => isConfirmation(t.text, detector.keywords));
      return hit
        ? { ...base, status: 'pass', turnIndex: hit.i, evidence: hit.text, explanation: 'Customer confirmed — goal reached.' }
        : { ...base, status: 'missed', explanation: 'Customer never confirmed — goal not reached.' };
    }
    case 'outcome_keyword': {
      // Question-guarded: asking "Did you book the appointment?" is not the outcome.
      const hit = turns
        .map((t, i) => ({ ...t, i }))
        .find((t) => matchKeyword(t.text, detector.keywords, insideQuestion));
      return hit
        ? { ...base, status: 'pass', turnIndex: hit.i, evidence: hit.text, explanation: 'Desired outcome detected.' }
        : { ...base, status: 'missed', explanation: 'Desired outcome not detected.' };
    }
    default:
      return { ...base, status: 'missed', explanation: `Unknown detector "${detector.kind}".` };
  }
}

/**
 * Full scoring breakdown for one call.
 *
 * `rawScore` is the weighted average. `score` is that average AFTER severity gating.
 * We keep both because the average is still useful for trends, but it must never be the
 * number a human reads as "this agent is fine" — a single critical compliance failure has
 * to dominate it. See ./severity.js for why critical and high cap at different ceilings.
 *
 * @returns {{
 *   rawScore: number|null, score: number|null, cap: number|null,
 *   gatedBy: 'critical'|'high'|null, violations: {critical:number, high:number}
 * }}
 */
export function scoreBreakdown(findings, criteria) {
  const byId = new Map(criteria.map((c) => [c.id, c]));
  const violations = { critical: 0, high: 0 };
  let earned = 0;
  let total = 0;

  for (const f of findings) {
    const c = byId.get(f.criterionId);
    if (!c) continue;                       // a finding with no matching criterion is unscorable
    total += c.weight;
    if (f.status === 'pass') {
      earned += c.weight;
    } else if (isGatingSeverity(c.severity)) {
      violations[c.severity] += 1;
    }
  }

  if (total <= 0) {
    // Nothing scorable → "not scored", NOT a perfect 100.
    return { rawScore: null, score: null, cap: null, gatedBy: null, violations };
  }

  const rawScore = Math.round((earned / total) * 100);
  const { score, cap, gatedBy } = gateScore(rawScore, violations);

  return { rawScore, score, cap, gatedBy, violations };
}

/**
 * Score = weighted fraction of criteria passed, 0..100, after severity gating.
 * Returns null when there is nothing scorable.
 */
export function scoreCall(findings, criteria) {
  return scoreBreakdown(findings, criteria).score;
}

/**
 * Analyze one call against its criteria (deterministic).
 */
export function analyzeCallDeterministic(call, transcript, criteria) {
  const findings = criteria.map((c) => evaluateCriterion(call, transcript, c));
  const { rawScore, score, cap, gatedBy, violations } = scoreBreakdown(findings, criteria);

  return {
    callId: call.id,
    agentId: call.agentId,
    score,                    // gated — what the UI shows
    rawScore,                 // ungated weighted average — kept for trends/debugging
    scoreCap: cap,            // the ceiling that was applied, if any
    gatedBy,                  // which severity triggered the gate
    violations,               // { critical, high } counts
    findings,
    engine: 'deterministic',
    scoredAt: new Date().toISOString(),
  };
}
