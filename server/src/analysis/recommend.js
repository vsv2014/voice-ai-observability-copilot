import { getLlm, parseJsonLoose } from './llm/index.js';

/**
 * Generate recommendations for an agent from its criteria + the findings across
 * its calls. This is the "immediate recommendations for prompt/script fixes"
 * requirement and the payoff of the Validation Flywheel: each recommendation
 * lists the calls it would have fixed (affectedCallIds).
 *
 * @typedef {Object} Recommendation
 * @property {string} id
 * @property {string} agentId
 * @property {'prompt'|'script'|'config'} target
 * @property {string} title
 * @property {string} rationale
 * @property {string} suggestedChange
 * @property {'low'|'medium'|'high'} priority
 * @property {string[]} affectedCallIds
 */

/** Aggregate failing/missed findings by criterion across an agent's calls. */
export function aggregateFailures(agent, criteria, analyses) {
  const byCriterion = new Map();
  for (const a of analyses) {
    for (const f of a.findings) {
      if (f.status === 'pass') continue;
      const entry = byCriterion.get(f.criterionId) || {
        criterion: criteria.find((c) => c.id === f.criterionId),
        count: 0,
        callIds: [],
        sample: f,
      };
      entry.count += 1;
      entry.callIds.push(f.callId);
      byCriterion.set(f.criterionId, entry);
    }
  }
  return [...byCriterion.values()]
    .filter((e) => e.criterion)
    .sort((a, b) => b.count - a.count);
}

export async function generateRecommendations(agent, criteria, analyses) {
  const failures = aggregateFailures(agent, criteria, analyses);
  if (!failures.length) return [];

  const llm = getLlm();
  if (llm.available) {
    try {
      return await llmRecommendations(agent, failures, llm);
    } catch (err) {
      console.warn(`[recommend] LLM failed (${err.message}); using templated recs.`);
    }
  }
  return templatedRecommendations(agent, failures);
}

// ── Templated (no-key) recommendations ──
function templatedRecommendations(agent, failures) {
  return failures.slice(0, 5).map((e, idx) => {
    const c = e.criterion;
    const rate = e.count;
    return {
      id: `${agent.id}:rec:${idx}`,
      agentId: agent.id,
      target: c.type === 'compliance' ? 'prompt' : 'script',
      title: `Fix: ${c.label}`,
      rationale: `${rate} call(s) failed "${c.label}" (${c.type}, ${c.severity} severity).`,
      suggestedChange: suggestionFor(c),
      priority: c.severity,
      affectedCallIds: [...new Set(e.callIds)],
    };
  });
}

function suggestionFor(c) {
  switch (c.detector.kind) {
    case 'agent_says':
      return `Add an explicit instruction to the prompt requiring the agent to "${c.label.toLowerCase()}". Example keywords to include: ${(c.detector.keywords || []).slice(0, 3).join(', ')}.`;
    case 'agent_avoids':
      return `Add a guardrail forbidding phrases like: ${(c.detector.keywords || []).slice(0, 3).join(', ')}. Reinforce with a "never make guarantees" rule.`;
    case 'question_asked':
      return `Instruct the agent to always ask at least one qualifying question before wrapping up (e.g. about ${(c.detector.keywords || []).slice(0, 2).join(' or ')}).`;
    case 'customer_confirms':
      return `Add a closing step that explicitly asks the customer to confirm, and re-states the details before ending the call.`;
    default:
      return `Review the prompt to ensure "${c.label}" is consistently handled.`;
  }
}

// ── LLM recommendations ──
async function llmRecommendations(agent, failures, llm) {
  const prompt = buildRecPrompt(agent, failures);
  const raw = await llm.complete(prompt);
  const parsed = parseJsonLoose(raw);
  const items = Array.isArray(parsed) ? parsed : parsed?.recommendations;
  if (!Array.isArray(items)) throw new Error('LLM returned no recommendations array');

  // Only keep recs we can tie back to a real failure, so affectedCallIds/title/
  // priority are always sourced from the criterion the rec is actually about.
  // A rec whose criterionId matches nothing is dropped rather than misattributed
  // to an unrelated failure by position.
  const recs = items
    .slice(0, 5)
    .map((r, idx) => {
      const source = failures.find((f) => f.criterion.id === r.criterionId);
      if (!source) return null;
      return {
        id: `${agent.id}:rec:${idx}`,
        agentId: agent.id,
        target: ['prompt', 'script', 'config'].includes(r.target) ? r.target : 'prompt',
        title: r.title || `Fix: ${source.criterion.label}`,
        rationale: r.rationale || '',
        suggestedChange: r.suggestedChange || '',
        priority: ['low', 'medium', 'high'].includes(r.priority) ? r.priority : source.criterion.severity,
        affectedCallIds: [...new Set(source.callIds)],
      };
    })
    .filter(Boolean);

  // If the LLM produced nothing we can attribute, fall back to templated recs
  // rather than returning an empty list for an agent that clearly has failures.
  if (!recs.length) throw new Error('no LLM recommendation matched a known failure');
  return recs;
}

function buildRecPrompt(agent, failures) {
  const failureLines = failures
    .map((e) => `- criterionId="${e.criterion.id}" label="${e.criterion.label}" type=${e.criterion.type} failedCalls=${e.count} example="${(e.sample.evidence || e.sample.explanation).slice(0, 140)}"`)
    .join('\n');

  return `You are a Voice AI QA analyst for HighLevel. An agent named "${agent.name}" has this goal:
"${agent.goal}"

Current prompt/script:
"""${(agent.prompt || '').slice(0, 1200)}"""

Across recent calls, these success criteria FAILED most often:
${failureLines}

Produce concrete, actionable recommendations to fix the agent's prompt/script.
Return ONLY JSON of this exact shape:
{"recommendations":[{"criterionId":"...","target":"prompt|script|config","title":"...","rationale":"...","suggestedChange":"<a specific edit or line to add to the prompt>","priority":"low|medium|high"}]}
Return at most 5, ordered by impact. Be specific and reference the agent's goal.`;
}
