import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateCriterion,
  scoreCall,
  scoreBreakdown,
} from '../src/analysis/deterministic.js';
import { SCORE_CAPS } from '../src/analysis/severity.js';

const call = { id: 'c1', agentId: 'a1' };
const tx = (turns) => ({ callId: 'c1', turns });
const crit = (kind, keywords, extra = {}) => ({
  id: 'k1', agentId: 'a1', label: 'test', type: 'goal',
  detector: { kind, keywords }, weight: 1, severity: 'high', ...extra,
});

test('customer_confirms: "not sure" is NOT a confirmation (negation)', () => {
  const t = tx([{ role: 'customer', text: "I'm not sure yet.", startMs: 0, endMs: 1 }]);
  const f = evaluateCriterion(call, t, crit('customer_confirms', ['yes', 'sure', 'okay']));
  assert.equal(f.status, 'missed');
});

test('customer_confirms: "yesterday" does NOT match "yes" (word boundary)', () => {
  const t = tx([{ role: 'customer', text: 'I called yesterday about this.', startMs: 0, endMs: 1 }]);
  const f = evaluateCriterion(call, t, crit('customer_confirms', ['yes']));
  assert.equal(f.status, 'missed');
});

test('customer_confirms: a real "yes, that works" passes', () => {
  const t = tx([{ role: 'customer', text: 'Yes, that works for me.', startMs: 0, endMs: 1 }]);
  const f = evaluateCriterion(call, t, crit('customer_confirms', ['yes', 'that works']));
  assert.equal(f.status, 'pass');
});

test('agent_avoids: "I cannot guarantee savings" is compliant (negation)', () => {
  const t = tx([{ role: 'agent', text: 'I cannot guarantee savings, but a specialist can help.', startMs: 0, endMs: 1 }]);
  const f = evaluateCriterion(call, t, crit('agent_avoids', ['guarantee', 'no risk']));
  assert.equal(f.status, 'pass');
});

test('agent_avoids: an actual guarantee is flagged', () => {
  const t = tx([{ role: 'agent', text: 'I guarantee you will save 50%.', startMs: 0, endMs: 1 }]);
  const f = evaluateCriterion(call, t, crit('agent_avoids', ['guarantee']));
  assert.equal(f.status, 'fail');
  assert.equal(f.turnIndex, 0);
});

test('agent_avoids: "100%" matches despite non-word edge char', () => {
  const t = tx([{ role: 'agent', text: 'You will be 100% satisfied.', startMs: 0, endMs: 1 }]);
  const f = evaluateCriterion(call, t, crit('agent_avoids', ['100%']));
  assert.equal(f.status, 'fail');
});

test('scoreCall returns null (not 100) when nothing is scorable', () => {
  assert.equal(scoreCall([], []), null);
});

test('scoreCall computes weighted percentage', () => {
  const criteria = [
    { id: 'a', weight: 0.5 },
    { id: 'b', weight: 0.5 },
  ];
  const findings = [
    { criterionId: 'a', status: 'pass' },
    { criterionId: 'b', status: 'fail' },
  ];
  assert.equal(scoreCall(findings, criteria), 50);
});

test('missing detector does not throw', () => {
  const f = evaluateCriterion(call, tx([]), { id: 'x', label: 'y', severity: 'low' });
  assert.equal(f.status, 'missed');
});

// ── Severity gate: a critical/high failure must never hide behind a good average ──

/** 9 passing low-severity criteria + 1 failing criterion at `severity`. */
function mostlyGood(severity) {
  const criteria = [
    ...Array.from({ length: 9 }, (_, i) => ({ id: `ok${i}`, weight: 1, severity: 'low' })),
    { id: 'bad', weight: 1, severity },
  ];
  const findings = [
    ...Array.from({ length: 9 }, (_, i) => ({ criterionId: `ok${i}`, status: 'pass' })),
    { criterionId: 'bad', status: 'fail' },
  ];
  return { criteria, findings };
}

test('gate: a CRITICAL failure caps the score even when 90% of criteria pass', () => {
  const { criteria, findings } = mostlyGood('critical');
  const b = scoreBreakdown(findings, criteria);

  assert.equal(b.rawScore, 90, 'ungated average is still available');
  assert.equal(b.gatedBy, 'critical');
  assert.equal(b.score, SCORE_CAPS.critical);
  assert.ok(b.score <= 49, 'a critical violation must not read as healthy');
  assert.equal(b.violations.critical, 1);
});

test('gate: a HIGH failure caps the score, but less strictly than critical', () => {
  const { criteria, findings } = mostlyGood('high');
  const b = scoreBreakdown(findings, criteria);
  assert.equal(b.rawScore, 90);
  assert.equal(b.gatedBy, 'high');
  assert.equal(b.score, SCORE_CAPS.high);
});

test('gate: critical and high remain DISTINCT levels', () => {
  const c = mostlyGood('critical');
  const h = mostlyGood('high');
  const crit = scoreBreakdown(c.findings, c.criteria);
  const high = scoreBreakdown(h.findings, h.criteria);

  assert.equal(crit.rawScore, high.rawScore, 'same ungated average…');
  assert.ok(SCORE_CAPS.critical < SCORE_CAPS.high, 'critical caps lower than high');
  assert.ok(crit.score < high.score, '…but different gated scores');
  assert.equal(crit.gatedBy, 'critical');
  assert.equal(high.gatedBy, 'high');
});

test('gate: critical outranks high when both fail', () => {
  const criteria = [
    { id: 'c', weight: 1, severity: 'critical' },
    { id: 'h', weight: 1, severity: 'high' },
    { id: 'ok', weight: 8, severity: 'low' },
  ];
  const findings = [
    { criterionId: 'c', status: 'fail' },
    { criterionId: 'h', status: 'missed' },
    { criterionId: 'ok', status: 'pass' },
  ];
  const b = scoreBreakdown(findings, criteria);
  assert.equal(b.gatedBy, 'critical', 'strictest applicable cap wins');
  assert.equal(b.score, SCORE_CAPS.critical);
  assert.deepEqual(b.violations, { critical: 1, high: 1 });
});

test('gate: does NOT fire when the critical criterion passes', () => {
  const criteria = [{ id: 'c', weight: 1, severity: 'critical' }];
  const b = scoreBreakdown([{ criterionId: 'c', status: 'pass' }], criteria);
  assert.equal(b.score, 100);
  assert.equal(b.gatedBy, null);
  assert.equal(b.violations.critical, 0);
});

test('gate: a "missed" critical still gates (not just an outright fail)', () => {
  const criteria = [
    { id: 'c', weight: 1, severity: 'critical' },
    { id: 'ok', weight: 9, severity: 'low' },
  ];
  const b = scoreBreakdown(
    [{ criterionId: 'c', status: 'missed' }, { criterionId: 'ok', status: 'pass' }],
    criteria
  );
  assert.equal(b.gatedBy, 'critical');
});

test('gate: never raises a genuinely low score', () => {
  const criteria = [
    { id: 'c', weight: 1, severity: 'critical' },
    { id: 'x', weight: 9, severity: 'low' },
  ];
  const b = scoreBreakdown(
    [{ criterionId: 'c', status: 'fail' }, { criterionId: 'x', status: 'fail' }],
    criteria
  );
  assert.equal(b.rawScore, 0);
  assert.equal(b.score, 0, 'the cap is a ceiling, not a floor');
});

test('gate: medium/low failures are weighted only, never gated', () => {
  const { criteria, findings } = mostlyGood('medium');
  const b = scoreBreakdown(findings, criteria);
  assert.equal(b.gatedBy, null);
  assert.equal(b.score, 90, 'ordinary failures still just lower the average');
});

test('scoreCall stays backwards compatible and returns the GATED score', () => {
  const { criteria, findings } = mostlyGood('critical');
  assert.equal(scoreCall(findings, criteria), SCORE_CAPS.critical);
});

// ── Negation must respect clause boundaries ──
// A negator in an EARLIER clause does not negate the keyword. Without this, a leading
// discourse marker was enough to hide a compliance violation entirely.

test('agent_avoids: a sentence-initial "No," does NOT excuse a real guarantee', () => {
  const t = tx([{ role: 'agent', text: 'No, I guarantee it will work.', startMs: 0, endMs: 1 }]);
  const f = evaluateCriterion(call, t, crit('agent_avoids', ['guarantee']));
  assert.equal(f.status, 'fail');
});

test('agent_avoids: "Not only that, I guarantee…" is still a violation', () => {
  const t = tx([{ role: 'agent', text: 'Not only that, I guarantee 40% savings.', startMs: 0, endMs: 1 }]);
  const f = evaluateCriterion(call, t, crit('agent_avoids', ['guarantee']));
  assert.equal(f.status, 'fail');
});

test('agent_avoids: a negated mention does not mask a real one later in the turn', () => {
  const t = tx([{
    role: 'agent',
    text: "I can't guarantee savings, but I guarantee you'll love it.",
    startMs: 0, endMs: 1,
  }]);
  const f = evaluateCriterion(call, t, crit('agent_avoids', ['guarantee']));
  assert.equal(f.status, 'fail', 'every occurrence is checked, not just the first');
});

test('agent_avoids: same-clause negation is still respected', () => {
  for (const text of [
    'I cannot guarantee savings.',
    "I can't promise you anything specific.",
    'We never guarantee a specific amount.',
    'There is no guarantee of savings.',
  ]) {
    const t = tx([{ role: 'agent', text, startMs: 0, endMs: 1 }]);
    const f = evaluateCriterion(call, t, crit('agent_avoids', ['guarantee', 'promise you']));
    assert.equal(f.status, 'pass', `should be compliant: "${text}"`);
  }
});

// ── A question is not a confirmation ──

test('customer_confirms: "Can you confirm the price?" is NOT a confirmation', () => {
  const t = tx([{ role: 'customer', text: 'Can you confirm what the price is?', startMs: 0, endMs: 1 }]);
  const f = evaluateCriterion(call, t, crit('customer_confirms', ['confirm']));
  assert.equal(f.status, 'missed');
});

test('customer_confirms: other interrogatives are not confirmations either', () => {
  for (const text of ['Is that okay?', 'Are you sure?', 'What if I say yes?']) {
    const t = tx([{ role: 'customer', text, startMs: 0, endMs: 1 }]);
    const f = evaluateCriterion(call, t, crit('customer_confirms', ['yes', 'sure', 'okay']));
    assert.equal(f.status, 'missed', `should not confirm: "${text}"`);
  }
});

test('customer_confirms: a confirmation that trails into a question still passes', () => {
  const t = tx([{ role: 'customer', text: 'Yes, that works — can we do 3pm?', startMs: 0, endMs: 1 }]);
  const f = evaluateCriterion(call, t, crit('customer_confirms', ['yes', 'that works']));
  assert.equal(f.status, 'pass', 'opens with a confirmation, so it is one');
});

test('customer_confirms: a turn that opens with a refusal is not a confirmation', () => {
  for (const text of ["No thanks, I'm okay.", 'Nope, I am good.', 'Not interested, thanks.']) {
    const t = tx([{ role: 'customer', text, startMs: 0, endMs: 1 }]);
    const f = evaluateCriterion(call, t, crit('customer_confirms', ['yes', 'okay', 'sure', 'good']));
    assert.equal(f.status, 'missed', `should decline: "${text}"`);
  }
});

test('customer_confirms: "No problem" is an affirmative idiom, not a refusal', () => {
  const t = tx([{ role: 'customer', text: 'No problem, that works for me.', startMs: 0, endMs: 1 }]);
  const f = evaluateCriterion(call, t, crit('customer_confirms', ['that works']));
  assert.equal(f.status, 'pass');
});

test('outcome_keyword: asking about the outcome is not the outcome', () => {
  const t = tx([{ role: 'agent', text: 'Did you book the appointment?', startMs: 0, endMs: 1 }]);
  const f = evaluateCriterion(call, t, crit('outcome_keyword', ['book', 'appointment']));
  assert.equal(f.status, 'missed');
});

test('agent_says: a question still satisfies a required step', () => {
  const t = tx([{ role: 'agent', text: 'Would you like to book an appointment?', startMs: 0, endMs: 1 }]);
  const f = evaluateCriterion(call, t, crit('agent_says', ['book']));
  assert.equal(f.status, 'pass', 'offering to book IS the required step');
});
