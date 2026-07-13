/**
 * Normalized domain shapes used everywhere downstream of the adapter.
 * These mirror real HighLevel objects (Voice AI agents, Conversations/Calls,
 * message transcripts) but are trimmed to what observability needs. The
 * LiveAdapter is responsible for mapping raw GHL payloads onto these.
 *
 * @typedef {Object} VoiceAgent
 * @property {string} id
 * @property {string} name
 * @property {string} goal            One-line business objective of the agent.
 * @property {string} prompt          The system prompt / script the agent runs.
 * @property {string[]} tags
 *
 * @typedef {Object} TranscriptTurn
 * @property {'agent'|'customer'} role
 * @property {string} text
 * @property {number} startMs         Offset from call start.
 * @property {number} endMs
 *
 * @typedef {Object} Transcript
 * @property {string} callId
 * @property {TranscriptTurn[]} turns
 *
 * @typedef {Object} Call
 * @property {string} id
 * @property {string} agentId
 * @property {string} contactId
 * @property {'inbound'|'outbound'} direction
 * @property {string} startedAt       ISO timestamp.
 * @property {number} durationSec
 * @property {'completed'|'no-answer'|'voicemail'|'failed'} status
 * @property {string} [recordingUrl]
 * @property {Transcript} [transcript] Present on getCall(); omitted from list.
 */

export {};
