import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCriteria } from '../src/analysis/validate.js';

// Regression: `PUT /criteria` with [] returned {ok:true,count:0}, deleted the agent's
// stored rows, then silently re-seeded defaults on the next read — reporting success for
// an edit that never took effect.
test('validateCriteria rejects an empty array instead of silently wiping', () => {
  const r = validateCriteria([], 'a1');
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /must not be empty/);
});

test('validateCriteria rejects a non-array body', () => {
  assert.equal(validateCriteria(undefined, 'a1').ok, false);
  assert.equal(validateCriteria({}, 'a1').ok, false);
  assert.equal(validateCriteria('nope', 'a1').ok, false);
});

test('validateCriteria rejects an unknown detector kind', () => {
  const r = validateCriteria([{ label: 'x', detector: { kind: 'bogus' } }], 'a1');
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /detector\.kind/);
});

test('validateCriteria rejects a negative weight', () => {
  const r = validateCriteria(
    [{ label: 'x', detector: { kind: 'agent_says', keywords: ['hi'] }, weight: -1 }],
    'a1'
  );
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /weight/);
});

test('validateCriteria normalizes a valid criterion and scopes it to the agent', () => {
  const r = validateCriteria(
    [{ label: '  Mentions insurance  ', detector: { kind: 'agent_says', keywords: ['insurance'] }, severity: 'high' }],
    'a1'
  );
  assert.equal(r.ok, true);
  assert.equal(r.criteria.length, 1);
  assert.deepEqual(
    { ...r.criteria[0] },
    {
      id: 'a1:mentions-insurance',
      agentId: 'a1',
      label: 'Mentions insurance',
      type: 'required_step',
      detector: { kind: 'agent_says', keywords: ['insurance'] },
      weight: 0,
      severity: 'high',
    }
  );
});

test('validateCriteria falls back to medium for an unknown severity', () => {
  const r = validateCriteria(
    [{ label: 'x', detector: { kind: 'agent_says', keywords: ['hi'] }, severity: 'catastrophic' }],
    'a1'
  );
  assert.equal(r.ok, true);
  assert.equal(r.criteria[0].severity, 'medium');
});
