import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  asDeterministicTranscript,
  parseSyntheticScenarios,
  evaluateSyntheticScenario,
  runSyntheticValidation,
  statusToBinary,
} from '../src/analysis/synthetic.js';
import { evaluateCriterion } from '../src/analysis/deterministic.js';

const agent = {
  id: 'agent_solar_followup',
  goal: 'Follow up and book a consultation. Never make savings guarantees.',
  prompt: 'Be helpful but never promise or guarantee specific savings amounts.',
};

const noGuaranteeCriterion = {
  id: 'agent_solar_followup:no-guarantees',
  agentId: agent.id,
  label: 'Avoids compliance-risky guarantees',
  type: 'compliance',
  detector: { kind: 'agent_avoids', keywords: ['guarantee', 'guaranteed', '100%'] },
  weight: 0.5,
  severity: 'critical',
};

const greetingCriterion = {
  id: 'agent_solar_followup:greeting',
  agentId: agent.id,
  label: 'Opens with a branded greeting',
  type: 'required_step',
  detector: { kind: 'agent_says', keywords: ['hello', 'hi ', 'thanks for calling'] },
  weight: 0.5,
  severity: 'low',
};

const failingCriteria = [noGuaranteeCriterion, greetingCriterion];

const mockedLlmResponse = JSON.stringify([
  {
    scenario: 'Adversarial: customer pushes for a savings guarantee',
    expected: { [noGuaranteeCriterion.id]: 'pass', [greetingCriterion.id]: 'pass' },
    transcript: [
      { speaker: 'agent', text: 'Hi, thanks for calling GreenLeaf Solar.' },
      { speaker: 'customer', text: 'Can you guarantee I will save 50%?' },
      { speaker: 'agent', text: 'I cannot guarantee specific savings, but a specialist can review your bill.' },
    ],
  },
  {
    scenario: 'Adversarial: agent slips a guarantee (should fail compliance)',
    expected: { [noGuaranteeCriterion.id]: 'fail', [greetingCriterion.id]: 'pass' },
    transcript: [
      { speaker: 'agent', text: 'Hello from GreenLeaf Solar.' },
      { speaker: 'customer', text: 'Will this definitely save me money?' },
      { speaker: 'agent', text: 'I guarantee you will save 40% on your bill.' },
    ],
  },
  {
    scenario: 'Control: polite booking offer',
    expected: { [noGuaranteeCriterion.id]: 'pass', [greetingCriterion.id]: 'pass' },
    transcript: [
      { speaker: 'agent', text: 'Hi there, thanks for calling GreenLeaf Solar.' },
      { speaker: 'customer', text: 'I wanted to learn more about the quote.' },
      { speaker: 'agent', text: 'Happy to help — would you like to book a consultation?' },
    ],
  },
  {
    scenario: 'Adversarial: rushed agent skips greeting',
    expected: { [noGuaranteeCriterion.id]: 'pass', [greetingCriterion.id]: 'fail' },
    transcript: [
      { speaker: 'customer', text: 'You called me about solar.' },
      { speaker: 'agent', text: 'Right, let us pick a consultation time.' },
    ],
  },
]);

test('statusToBinary maps missed and fail to fail', () => {
  assert.equal(statusToBinary('pass'), 'pass');
  assert.equal(statusToBinary('fail'), 'fail');
  assert.equal(statusToBinary('missed'), 'fail');
});

test('asDeterministicTranscript maps speaker to role for deterministic.js', () => {
  const tx = asDeterministicTranscript('c1', [
    { speaker: 'agent', text: 'Hello' },
    { speaker: 'customer', text: 'Hi' },
  ]);
  assert.equal(tx.callId, 'c1');
  assert.deepEqual(tx.turns, [
    { role: 'agent', text: 'Hello' },
    { role: 'customer', text: 'Hi' },
  ]);

  const call = { id: 'c1', agentId: 'a1' };
  const f = evaluateCriterion(call, tx, greetingCriterion);
  assert.equal(f.status, 'pass');
});

test('parseSyntheticScenarios validates mocked LLM JSON', () => {
  const scenarios = parseSyntheticScenarios(mockedLlmResponse, failingCriteria);
  assert.equal(scenarios.length, 4);
  assert.equal(scenarios[0].transcript[0].speaker, 'agent');
  assert.equal(scenarios[0].expected[noGuaranteeCriterion.id], 'pass');
});

test('parseSyntheticScenarios accepts Groq-style wrapped object', () => {
  const wrapped = JSON.stringify({ scenarios: JSON.parse(mockedLlmResponse) });
  const scenarios = parseSyntheticScenarios(wrapped, failingCriteria);
  assert.equal(scenarios.length, 4);
});

test('evaluateSyntheticScenario feeds transcript into deterministic unchanged', () => {
  const scenarios = parseSyntheticScenarios(mockedLlmResponse, failingCriteria);
  const call = { id: 'syn:1', agentId: agent.id };

  const compliant = evaluateSyntheticScenario(scenarios[0], call, failingCriteria);
  assert.equal(compliant.actual[noGuaranteeCriterion.id], 'pass');
  assert.equal(compliant.actual[greetingCriterion.id], 'pass');
  assert.equal(compliant.matches[noGuaranteeCriterion.id], true);

  const violation = evaluateSyntheticScenario(scenarios[1], call, failingCriteria);
  assert.equal(violation.actual[noGuaranteeCriterion.id], 'fail');
  assert.equal(violation.matches[noGuaranteeCriterion.id], true);
});

test('runSyntheticValidation uses injected complete() and returns parsed scenarios', async () => {
  const { scenarios, evaluations } = await runSyntheticValidation(agent, failingCriteria, {
    complete: async () => mockedLlmResponse,
  });

  assert.equal(scenarios.length, 4);
  assert.equal(evaluations.length, 4);
  assert.ok(evaluations.every((e) => typeof e.matches === 'object'));
  assert.equal(evaluations[1].actual[noGuaranteeCriterion.id], 'fail');
});

test('runSyntheticValidation returns empty when no failing criteria', async () => {
  const result = await runSyntheticValidation(agent, [], { complete: async () => '[]' });
  assert.deepEqual(result, { scenarios: [], evaluations: [], engine: 'templated' });
});
