import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store/store.js';
import { accountOverview, agentSummary } from '../src/analysis/metrics.js';
import { SCORE_CAPS } from '../src/analysis/severity.js';

// The regression these cover: the severity gate protected the CALL score, but agent and
// account scores were a plain mean of gated scores. A capped call (39) beside a clean one
// (100) averaged to 70 — so the only agent with a compliance violation showed the highest
// score of all and sorted last in a "worst first" table.

const agent = (id) => ({ id, name: id, goal: '', prompt: '', tags: [] });

/** One call analysis: `severity` is the severity of its single FAILING criterion. */
function analysis(callId, agentId, score, failSeverity = null) {
  const findings = [{ criterionId: 'ok', label: 'ok', status: 'pass', severity: 'low' }];
  if (failSeverity) {
    findings.push({ criterionId: 'bad', label: 'bad', status: 'fail', severity: failSeverity });
  }
  return { callId, agentId, score, rawScore: score, findings };
}

const criteria = [
  { id: 'ok', agentId: 'a1', label: 'ok', type: 'required_step', severity: 'low', weight: 1 },
  { id: 'bad', agentId: 'a1', label: 'bad', type: 'compliance', severity: 'critical', weight: 1 },
];

beforeEach(() => store.reset());

test('agent rollup: a critical violation caps the average, not just the call', () => {
  store.putCallAnalysis(analysis('c1', 'a1', 39, 'critical'));
  store.putCallAnalysis(analysis('c2', 'a1', 100));

  const s = agentSummary(agent('a1'), criteria);
  assert.equal(s.rawAvgScore, 70, 'ungated mean is still available for trends');
  assert.equal(s.gatedBy, 'critical');
  assert.equal(s.avgScore, SCORE_CAPS.critical);
  assert.ok(s.avgScore <= 49, 'an agent with a live compliance violation cannot read healthy');
});

test('agent rollup: a high-severity failure caps less strictly than critical', () => {
  store.putCallAnalysis(analysis('c1', 'a1', 69, 'high'));
  store.putCallAnalysis(analysis('c2', 'a1', 100));

  const s = agentSummary(agent('a1'), criteria);
  assert.equal(s.gatedBy, 'high');
  assert.equal(s.avgScore, SCORE_CAPS.high);
});

test('agent rollup: no gate when nothing gating failed', () => {
  store.putCallAnalysis(analysis('c1', 'a1', 80));
  store.putCallAnalysis(analysis('c2', 'a1', 100));

  const s = agentSummary(agent('a1'), criteria);
  assert.equal(s.gatedBy, null);
  assert.equal(s.avgScore, 90);
});

test('agent rollup: the cap is a ceiling, never a floor', () => {
  store.putCallAnalysis(analysis('c1', 'a1', 10, 'critical'));

  const s = agentSummary(agent('a1'), criteria);
  assert.equal(s.avgScore, 10, 'a genuinely worse average is left alone');
});

test('agent rollup: an unscored agent stays unscored (not 0, not capped)', () => {
  const s = agentSummary(agent('a1'), criteria);
  assert.equal(s.avgScore, null);
  assert.equal(s.rawAvgScore, null);
  assert.equal(s.gatedBy, null);
});

test('account rollup: the account average is gated the same way', () => {
  store.putCallAnalysis(analysis('c1', 'a1', 39, 'critical'));
  store.putCallAnalysis(analysis('c2', 'a1', 100));

  const ov = accountOverview([agent('a1')], criteria);
  assert.equal(ov.totals.rawAvgScore, 70);
  assert.equal(ov.totals.gatedBy, 'critical');
  assert.equal(ov.totals.avgScore, SCORE_CAPS.critical);
  assert.equal(ov.totals.criticalViolations, 1, 'still surfaced as a raw count too');
});

test('account rollup: the agent with a compliance violation sorts FIRST', () => {
  // a2/a3 score worse on the raw mean, but only a1 has a liability.
  store.putCallAnalysis(analysis('c1', 'a1', 39, 'critical'));
  store.putCallAnalysis(analysis('c2', 'a1', 100));
  store.putCallAnalysis(analysis('c3', 'a2', 64));
  store.putCallAnalysis(analysis('c4', 'a3', 65));

  const ov = accountOverview([agent('a1'), agent('a2'), agent('a3')], criteria);
  assert.equal(ov.agents[0].id, 'a1', 'worst first must mean the violation, not the lowest mean');
  assert.deepEqual(ov.agents.map((a) => a.id), ['a1', 'a2', 'a3']);
});

test('account rollup: unscored agents sort last', () => {
  store.putCallAnalysis(analysis('c1', 'a2', 50));

  const ov = accountOverview([agent('a1'), agent('a2')], criteria);
  assert.deepEqual(ov.agents.map((a) => a.id), ['a2', 'a1']);
});
