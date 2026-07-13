import { DETECTOR_KINDS } from './criteria.js';

const SEVERITIES = ['low', 'medium', 'high'];
const kinds = new Set(DETECTOR_KINDS);

/**
 * Validate + normalize a user-supplied criteria array before it is persisted.
 * Rejects anything the analyzer can't evaluate, so a malformed PUT can neither
 * wipe an agent's criteria silently nor poison a later analysis run.
 *
 * @returns {{ ok: true, criteria: object[] } | { ok: false, errors: string[] }}
 */
export function validateCriteria(input, agentId) {
  if (!Array.isArray(input)) {
    return { ok: false, errors: ['body must be an object with a "criteria" array'] };
  }

  const errors = [];
  const criteria = [];

  input.forEach((c, i) => {
    if (!c || typeof c !== 'object') {
      errors.push(`criteria[${i}]: must be an object`);
      return;
    }
    if (typeof c.label !== 'string' || !c.label.trim()) {
      errors.push(`criteria[${i}]: "label" is required`);
      return;
    }
    if (!c.detector || !kinds.has(c.detector.kind)) {
      errors.push(`criteria[${i}]: detector.kind must be one of ${DETECTOR_KINDS.join(', ')}`);
      return;
    }
    if (c.weight != null && (typeof c.weight !== 'number' || c.weight < 0)) {
      errors.push(`criteria[${i}]: "weight" must be a non-negative number`);
      return;
    }

    criteria.push({
      id: c.id || `${agentId}:${c.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
      agentId,
      label: c.label.trim(),
      type: c.type || 'required_step',
      detector: {
        kind: c.detector.kind,
        keywords: Array.isArray(c.detector.keywords) ? c.detector.keywords.map(String) : [],
      },
      weight: typeof c.weight === 'number' ? c.weight : 0,
      severity: SEVERITIES.includes(c.severity) ? c.severity : 'medium',
    });
  });

  return errors.length ? { ok: false, errors } : { ok: true, criteria };
}
