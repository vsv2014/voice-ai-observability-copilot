import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CRITERIA_FILE = join(__dirname, '..', '..', 'data', 'criteria.json');

/** Strip a leading UTF-8 byte-order mark, which JSON.parse rejects. */
const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

/**
 * Read the saved criteria from disk (empty list if the file doesn't exist yet).
 *
 * Tolerant by design, because this file is meant to be hand-editable:
 *   • a UTF-8 BOM is stripped — any Windows editor or `>` redirect adds one, and a bare
 *     JSON.parse on a BOM throws, which previously 500'd EVERY read endpoint from a file
 *     that looks perfectly valid;
 *   • an unreadable or non-array file degrades to "no stored criteria" (so defaults are
 *     re-seeded) instead of taking the whole dashboard down.
 */
function readStored() {
  if (!existsSync(CRITERIA_FILE)) return [];
  try {
    const raw = readFileSync(CRITERIA_FILE, 'utf8');
    const parsed = JSON.parse(stripBom(raw));
    if (!Array.isArray(parsed)) throw new Error('expected a JSON array of criteria');
    return parsed;
  } catch (err) {
    console.warn(`[criteria] ignoring unreadable ${CRITERIA_FILE} (${err.message}); re-seeding defaults.`);
    return [];
  }
}

/**
 * Criteria (KPI) engine.
 *
 * A Criterion is a per-agent success rule derived from the agent's goal/script
 * and editable by the user. The deterministic analyzer and the LLM analyzer
 * both evaluate calls against these.
 *
 * Detector kinds (all evaluated against a normalized Transcript):
 *   agent_says       — an agent turn must match ANY of `keywords` (a required step)
 *   agent_avoids     — NO agent turn may match `keywords` (compliance guardrail)
 *   question_asked   — an agent turn contains '?' AND matches ANY `keywords`
 *   customer_confirms— a customer turn matches ANY `keywords` (goal reached)
 *   outcome_keyword  — ANY turn matches `keywords` (e.g. "booked", "appointment")
 *
 * @typedef {Object} Criterion
 * @property {string} id
 * @property {string} agentId
 * @property {string} label
 * @property {'required_step'|'goal'|'compliance'|'qualification'} type
 * @property {{kind:string, keywords?:string[]}} detector
 * @property {number} weight            0..1 contribution to the call score
 * @property {'low'|'medium'|'high'} severity  impact when it fails
 */

/** The detector kinds the deterministic analyzer knows how to evaluate. */
export const DETECTOR_KINDS = [
  'agent_says',
  'agent_avoids',
  'question_asked',
  'customer_confirms',
  'outcome_keyword',
];

/** Load all criteria (seeds defaults for agents that have none). */
export function loadCriteria(agents) {
  const stored = readStored();
  const covered = new Set(stored.map((c) => c.agentId));
  const seeded = agents
    .filter((a) => !covered.has(a.id))
    .flatMap((a) => defaultCriteriaFor(a));
  if (!seeded.length) return stored;
  const all = [...stored, ...seeded];
  persistCriteria(all);
  return all;
}

export function criteriaForAgent(agentId, all) {
  return all.filter((c) => c.agentId === agentId);
}

/**
 * Write the criteria set to disk. Returns whether it was actually persisted.
 *
 * Deliberately non-throwing: `loadCriteria` seeds-and-saves on a READ path, so an
 * unwritable data directory (a read-only container filesystem is a common hardening
 * default) used to turn every GET into a 500. Seeding now still works in memory and the
 * dashboard stays up; callers that need durability (the criteria PUT) check the result.
 */
export function persistCriteria(all) {
  try {
    writeFileSync(CRITERIA_FILE, JSON.stringify(all, null, 2));
    return true;
  } catch (err) {
    console.warn(`[criteria] could not save to ${CRITERIA_FILE} (${err.message}); continuing in memory.`);
    return false;
  }
}

/**
 * Derive a sensible starter set of criteria from an agent's goal/prompt/tags.
 * This is the "set observability parameters based on the agent's goals/script"
 * requirement — heuristic, and fully editable afterward.
 */
export function defaultCriteriaFor(agent) {
  const base = [
    {
      id: `${agent.id}:greeting`,
      agentId: agent.id,
      label: 'Opens with a branded greeting',
      type: 'required_step',
      detector: { kind: 'agent_says', keywords: ['thanks for calling', 'hello', 'hi ', 'how can i help', 'this is'] },
      weight: 0.15,
      severity: 'low',
    },
    {
      id: `${agent.id}:no-guarantees`,
      agentId: agent.id,
      label: 'Avoids compliance-risky guarantees',
      type: 'compliance',
      detector: { kind: 'agent_avoids', keywords: ['guarantee', 'guaranteed', '100%', 'promise you', 'no risk'] },
      weight: 0.15,
      // CRITICAL, not high: a compliance guarantee is a liability, not a performance
      // miss. This severity gates the call score (see ./severity.js).
      severity: 'critical',
    },
  ];

  const text = `${agent.goal} ${agent.prompt} ${(agent.tags || []).join(' ')}`.toLowerCase();

  if (/book|appointment|schedul|viewing|demo|calendar/.test(text)) {
    base.push({
      id: `${agent.id}:offer-booking`,
      agentId: agent.id,
      label: 'Offers to book an appointment',
      type: 'required_step',
      detector: { kind: 'agent_says', keywords: ['book', 'schedule', 'appointment', 'set up a time', 'calendar', 'availability'] },
      weight: 0.2,
      severity: 'medium',
    });
    base.push({
      id: `${agent.id}:booking-confirmed`,
      agentId: agent.id,
      label: 'Appointment confirmed by customer',
      type: 'goal',
      detector: { kind: 'customer_confirms', keywords: ['yes', 'that works', 'sounds good', 'sure', 'okay', 'book me', 'confirm'] },
      weight: 0.35,
      severity: 'high',
    });
  }

  if (/qualif|budget|timeline|lead|interested|need/.test(text)) {
    base.push({
      id: `${agent.id}:qualify`,
      agentId: agent.id,
      label: 'Asks a qualifying question',
      type: 'qualification',
      detector: { kind: 'question_asked', keywords: ['budget', 'timeline', 'looking for', 'interested in', 'how many', 'when'] },
      weight: 0.25,
      severity: 'medium',
    });
  }

  // Normalize weights to sum ~1 for a clean 0..100 score.
  const total = base.reduce((s, c) => s + c.weight, 0) || 1;
  return base.map((c) => ({ ...c, weight: Number((c.weight / total).toFixed(3)) }));
}
