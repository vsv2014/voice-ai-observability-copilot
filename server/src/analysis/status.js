/**
 * Shared vocabulary for finding status, so the "what counts as an open issue"
 * rule lives in exactly one place instead of being re-spelled as
 * `f.status !== 'pass'` across metrics, routes, and the UI.
 */
export const isOpen = (f) => f.status !== 'pass';
export const isHighSeverityOpen = (f) => isOpen(f) && f.severity === 'high';
