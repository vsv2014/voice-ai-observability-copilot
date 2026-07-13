import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCriterion, scoreCall } from '../src/analysis/deterministic.js';

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
