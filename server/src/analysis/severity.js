/**
 * The severity ladder — one source of truth.
 *
 * `critical` and `high` are deliberately DISTINCT:
 *
 *   critical — zero-tolerance, usually regulatory/compliance (e.g. making a savings
 *              guarantee). One occurrence is unacceptable regardless of how well the
 *              rest of the call went.
 *   high     — a serious business failure (e.g. the goal was never reached). Bad, but
 *              it is a performance problem rather than a liability.
 *   medium   — a missed step or opportunity.
 *   low      — polish.
 *
 * Both `critical` and `high` act as SCORE GATES: a weighted average must never let a
 * failure at these levels present as a healthy agent. They cap the score at different
 * ceilings so the two levels stay distinguishable in the UI and in the data.
 */
export const SEVERITIES = ['low', 'medium', 'high', 'critical'];

/** Sort order for surfacing issues to a human — lower rank is more urgent. */
export const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * Score ceilings applied when a criterion at this severity FAILS.
 * A critical failure can never read above 39; a high failure never above 69.
 * (Chosen to land clearly inside the UI's "bad" and "warn" score bands.)
 */
export const SCORE_CAPS = { critical: 39, high: 69 };

/** Severities that gate the score rather than merely contributing weight. */
export const isGatingSeverity = (severity) =>
  Object.prototype.hasOwnProperty.call(SCORE_CAPS, severity);

/** Rank helper that sorts unknown severities last instead of NaN-ing a comparator. */
export const rankOf = (severity) =>
  SEVERITY_RANK[severity] ?? Number.MAX_SAFE_INTEGER;
