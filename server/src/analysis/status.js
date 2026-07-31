import { isGatingSeverity } from './severity.js';

/**
 * Shared vocabulary for finding status, so the "what counts as an open issue" rule
 * lives in exactly one place instead of being re-spelled across metrics, routes and UI.
 */

/** Any criterion that did not pass (failed outright, or a missed opportunity). */
export const isOpen = (f) => f.status !== 'pass';

/** A zero-tolerance failure — compliance/liability. Gates the score. */
export const isCriticalOpen = (f) => isOpen(f) && f.severity === 'critical';

/** An open failure at `high` severity specifically — a serious business miss. */
export const isHighOpen = (f) => isOpen(f) && f.severity === 'high';

/**
 * An open finding severe enough to need a human ("Use Action"): critical OR high.
 * Both gate the score, which is exactly the definition of "cannot be averaged away".
 */
export const isEscalatableOpen = (f) => isOpen(f) && isGatingSeverity(f.severity);

/** @deprecated kept as an alias so older call sites keep working. */
export const isHighSeverityOpen = isEscalatableOpen;
