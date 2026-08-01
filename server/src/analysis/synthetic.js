import { getLlm, parseJsonLoose } from './llm/index.js';
import { analyzeCallDeterministic } from './deterministic.js';

/**
 * Synthetic scenario generator for the Validation Flywheel.
 *
 * Uses the agent's goal/prompt plus known failing criteria to ask an LLM for
 * short customer–agent transcripts, then scores each scenario with the same
 * deterministic engine used on real calls (no adapter or GHL calls).
 *
 * ── Assumptions (transcript shape) ──────────────────────────────────────
 *
 * 1. LLM output `transcript` is `[{ speaker, text }]`. `speaker` is mapped to
 *    `role` (`'agent'|'customer'`) when calling deterministic.js — the only
 *    field rename. Deterministic reads `role` and `text` only; `startMs`/`endMs`
 *    are omitted (optional in shapes.js and unused by evaluateCriterion).
 *
 * 2. `failingCriteria` items must carry a full `detector` (plus weight/severity)
 *    for deterministic scoring, not just `{ id, label, type }`. Those three
 *    fields drive the LLM prompt; detector is required for evaluation.
 *
 * 3. `expected` values are strictly `'pass'|'fail'`. Deterministic `'missed'`
 *    is treated as `'fail'` when comparing actual vs expected.
 *
 * 4. Only `agent.goal` and `agent.prompt` are sent to the LLM. `agent.id` (if
 *    present) scopes synthetic call ids; no other HighLevel/agent fields are used.
 *
 * @typedef {Object} SyntheticScenario
 * @property {string} scenario
 * @property {Record<string, 'pass'|'fail'>} expected
 * @property {{ speaker: string, text: string }[]} transcript
 */

const SCENARIO_MIN = 4;
const SCENARIO_MAX = 6;
const SPEAKER_TO_ROLE = new Map([
  ['agent', 'agent'],
  ['assistant', 'agent'],
  ['ai', 'agent'],
  ['bot', 'agent'],
  ['customer', 'customer'],
  ['caller', 'customer'],
  ['user', 'customer'],
  ['human', 'customer'],
]);

/** Collapse deterministic status to the binary pass/fail the LLM labels with. */
export function statusToBinary(status) {
  return status === 'pass' ? 'pass' : 'fail';
}

/**
 * Map LLM `{ speaker, text }[]` onto the Transcript.turns shape deterministic.js expects.
 * @param {string} callId
 * @param {{ speaker: string, text: string }[]} turns
 * @returns {{ callId: string, turns: { role: 'agent'|'customer', text: string }[] }}
 */
export function asDeterministicTranscript(callId, turns) {
  const mapped = (turns || []).map((t) => {
    const key = String(t.speaker || '').trim().toLowerCase();
    const role = SPEAKER_TO_ROLE.get(key);
    if (!role) throw new Error(`unknown transcript speaker "${t.speaker}"`);
    return { role, text: String(t.text || '') };
  });
  return { callId, turns: mapped };
}

/** Build the LLM prompt for 4–6 adversarial + control scenarios. */
export function buildSyntheticPrompt(agent, failingCriteria) {
  const criterionLines = failingCriteria
    .map((c) => `- id="${c.id}" label="${c.label}" type=${c.type} detector=${c.detector?.kind || 'unknown'}`)
    .join('\n');

  return `You are a Voice AI QA engineer testing whether an agent's prompt handles real call situations.

Agent goal:
"${agent.goal || ''}"

Agent prompt/script:
"""${(agent.prompt || '').slice(0, 1600)}"""

These criteria currently FAIL on real calls — design scenarios that stress-test whether the prompt fixes them:
${criterionLines}

Generate ${SCENARIO_MIN} to ${SCENARIO_MAX} SHORT customer–agent transcripts (4–8 turns each).

Rules:
- Include at least ONE adversarial scenario per criterion id above (customer behavior or edge case that pressures the agent toward violating that criterion).
- Also include control scenarios where a well-prompted agent should PASS.
- Write realistic dialogue; agent lines should reflect what THIS prompt would produce.
- For each scenario, label \`expected\` with ONLY the criterion ids listed above, each mapped to "pass" or "fail" (what a correctly prompted agent SHOULD achieve under deterministic keyword rules).
- Use speaker values "agent" or "customer" only.

Return ONLY JSON of this exact shape (Groq requires a top-level object, not a bare array):
{"scenarios":[
  {
    "scenario": "<one-line description, note if adversarial>",
    "expected": { "<criterionId>": "pass"|"fail", ... },
    "transcript": [{ "speaker": "agent"|"customer", "text": "..." }, ...]
  }
]}`;
}

/** Pull a scenarios array from LLM JSON (bare array or wrapped object). */
export function extractScenariosArray(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== 'object') return null;

  for (const key of ['scenarios', 'results', 'data', 'items', 'tests']) {
    if (Array.isArray(parsed[key])) return parsed[key];
  }

  for (const val of Object.values(parsed)) {
    if (
      Array.isArray(val) &&
      val.length &&
      val.every((v) => v && typeof v === 'object' && v.scenario && Array.isArray(v.transcript))
    ) {
      return val;
    }
  }

  return null;
}

/** Validate and normalize parsed LLM output. */
export function parseSyntheticScenarios(raw, failingCriteria) {
  const parsed = typeof raw === 'string' ? parseJsonLoose(raw) : raw;
  const items = extractScenariosArray(parsed);
  if (!Array.isArray(items)) throw new Error('LLM returned no scenarios array');

  if (items.length < SCENARIO_MIN || items.length > SCENARIO_MAX) {
    throw new Error(`expected ${SCENARIO_MIN}–${SCENARIO_MAX} scenarios, got ${items.length}`);
  }

  const validIds = new Set(failingCriteria.map((c) => c.id));

  return items.map((item, idx) => {
    if (!item || typeof item !== 'object') throw new Error(`scenarios[${idx}]: must be an object`);
    if (typeof item.scenario !== 'string' || !item.scenario.trim()) {
      throw new Error(`scenarios[${idx}]: "scenario" is required`);
    }
    if (!Array.isArray(item.transcript) || !item.transcript.length) {
      throw new Error(`scenarios[${idx}]: "transcript" must be a non-empty array`);
    }
    if (!item.expected || typeof item.expected !== 'object') {
      throw new Error(`scenarios[${idx}]: "expected" must be an object`);
    }

    const expected = {};
    for (const [id, val] of Object.entries(item.expected)) {
      if (!validIds.has(id)) throw new Error(`scenarios[${idx}]: unknown criterionId "${id}"`);
      if (val !== 'pass' && val !== 'fail') {
        throw new Error(`scenarios[${idx}]: expected.${id} must be "pass" or "fail"`);
      }
      expected[id] = val;
    }

    const transcript = item.transcript.map((turn, ti) => {
      if (!turn || typeof turn !== 'object') throw new Error(`scenarios[${idx}].transcript[${ti}]: invalid turn`);
      const speaker = String(turn.speaker || '').trim().toLowerCase();
      if (!SPEAKER_TO_ROLE.has(speaker)) {
        throw new Error(`scenarios[${idx}].transcript[${ti}]: speaker must be agent or customer`);
      }
      return { speaker, text: String(turn.text || '') };
    });

    return { scenario: item.scenario.trim(), expected, transcript };
  });
}

/**
 * Score one synthetic scenario through deterministic.js (unchanged API).
 * @returns {{ actual: Record<string,'pass'|'fail'>, matches: Record<string,boolean>, analysis: object }}
 */
export function evaluateSyntheticScenario(scenario, call, criteria) {
  const transcript = asDeterministicTranscript(call.id, scenario.transcript);
  const analysis = analyzeCallDeterministic(call, transcript, criteria);

  const actual = {};
  for (const c of criteria) {
    const finding = analysis.findings.find((f) => f.criterionId === c.id);
    actual[c.id] = statusToBinary(finding?.status ?? 'missed');
  }

  const matches = {};
  for (const [id, exp] of Object.entries(scenario.expected)) {
    matches[id] = actual[id] === exp;
  }

  return { actual, matches, analysis };
}

/** Score generated scenarios and package evaluations. */
function scoreScenarios(scenarios, agent, failingCriteria) {
  const agentId = agent.id || 'synthetic_agent';
  const evaluations = scenarios.map((scenario, idx) => {
    const call = { id: `${agentId}:syn:${idx}`, agentId };
    const { actual, matches, analysis } = evaluateSyntheticScenario(scenario, call, failingCriteria);
    return { scenario: scenario.scenario, expected: scenario.expected, actual, matches, analysis };
  });
  return { scenarios, evaluations };
}

/**
 * No-key fallback — handcrafted adversarial transcripts per detector kind.
 * Does not read the draft prompt for dialogue; use an LLM for prompt-aware tests.
 */
export function templatedSyntheticScenarios(agent, failingCriteria) {
  const scenarios = [];
  const expectedAll = Object.fromEntries(failingCriteria.map((c) => [c.id, 'pass']));

  for (const c of failingCriteria) {
    const kw = (c.detector?.keywords || [])[0] || 'yes';
    const passTurns = turnsForCriterion(c, kw, true);
    const failTurns = turnsForCriterion(c, kw, false);
    if (passTurns) {
      scenarios.push({
        scenario: `Adversarial (should pass): ${c.label}`,
        expected: { ...expectedAll, [c.id]: 'pass' },
        transcript: passTurns,
      });
    }
    if (failTurns && scenarios.length < SCENARIO_MAX) {
      const exp = { ...expectedAll, [c.id]: 'fail' };
      scenarios.push({
        scenario: `Adversarial (should fail): ${c.label}`,
        expected: exp,
        transcript: failTurns,
      });
    }
    if (scenarios.length >= SCENARIO_MAX) break;
  }

  while (scenarios.length < SCENARIO_MIN) {
    scenarios.push({
      scenario: 'Control: generic greeting exchange',
      expected: expectedAll,
      transcript: [
        { speaker: 'agent', text: 'Hello, thanks for calling. How can I help you today?' },
        { speaker: 'customer', text: 'Hi, I had a quick question.' },
        { speaker: 'agent', text: 'Sure, go ahead.' },
      ],
    });
  }

  return scenarios.slice(0, SCENARIO_MAX);
}

function turnsForCriterion(c, kw, shouldPass) {
  switch (c.detector?.kind) {
    case 'agent_says':
      return shouldPass
        ? [
            { speaker: 'agent', text: `Hello, thanks for calling. Would you like to ${kw} today?` },
            { speaker: 'customer', text: 'Maybe, tell me more.' },
          ]
        : [
            { speaker: 'customer', text: 'Hi there.' },
            { speaker: 'agent', text: 'How can I help you?' },
          ];
    case 'agent_avoids':
      return shouldPass
        ? [
            { speaker: 'customer', text: `Can you ${kw} results?` },
            { speaker: 'agent', text: `I cannot ${kw} specific outcomes, but our team can review your case.` },
          ]
        : [
            { speaker: 'customer', text: 'I need reassurance.' },
            { speaker: 'agent', text: `I ${kw} you will be completely satisfied.` },
          ];
    case 'question_asked':
      return shouldPass
        ? [
            { speaker: 'agent', text: `Before we wrap up, what is your ${kw}?` },
            { speaker: 'customer', text: 'Around six months.' },
          ]
        : [
            { speaker: 'agent', text: 'Thanks for your time today.' },
            { speaker: 'customer', text: 'You too.' },
          ];
    case 'customer_confirms':
      return shouldPass
        ? [
            { speaker: 'agent', text: 'Does Thursday at 2pm work for you?' },
            { speaker: 'customer', text: 'Yes, that works for me.' },
          ]
        : [
            { speaker: 'agent', text: 'Does Thursday at 2pm work for you?' },
            { speaker: 'customer', text: "I'm not sure yet." },
          ];
    case 'outcome_keyword':
      return shouldPass
        ? [
            { speaker: 'agent', text: `Great, your ${kw} is all set.` },
            { speaker: 'customer', text: 'Perfect, thank you.' },
          ]
        : [
            { speaker: 'agent', text: 'Let me know if you need anything else.' },
            { speaker: 'customer', text: 'Will do.' },
          ];
    default:
      return null;
  }
}

/**
 * Generate synthetic scenarios via LLM and score each with deterministic.js.
 * Falls back to templated scenarios when no LLM key is configured.
 *
 * @param {{ id?: string, goal: string, prompt: string }} agent
 * @param {import('./criteria.js').Criterion[]} failingCriteria
 * @param {{ complete?: (prompt: string) => Promise<string> }} [opts] inject for tests
 * @returns {Promise<{ scenarios: SyntheticScenario[], evaluations: object[], engine: 'llm'|'templated' }>}
 */
export async function runSyntheticValidation(agent, failingCriteria, opts = {}) {
  if (!failingCriteria?.length) {
    return { scenarios: [], evaluations: [], engine: 'templated' };
  }

  const completeFn = opts.complete ?? getLlm().complete;
  if (!completeFn) {
    const scenarios = templatedSyntheticScenarios(agent, failingCriteria);
    const scored = scoreScenarios(scenarios, agent, failingCriteria);
    return { ...scored, engine: 'templated' };
  }

  const prompt = buildSyntheticPrompt(agent, failingCriteria);
  const raw = await completeFn(prompt);
  const scenarios = parseSyntheticScenarios(raw, failingCriteria);
  const scored = scoreScenarios(scenarios, agent, failingCriteria);
  return { ...scored, engine: 'llm' };
}
