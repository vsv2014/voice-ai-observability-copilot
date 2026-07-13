# HighLevel API grounding (for the LiveAdapter)

This is the verified reference the `LiveAdapter` and mock shapes are built against.
Endpoints/headers/scopes below are confirmed from HighLevel's developer docs and
help portal. Where a full JSON schema was **not** exposed verbatim (Stoplight
renders schemas via JS), it's flagged — those are the fields to confirm against a
live response before hardcoding.

## Base + auth
- **Base URL:** `https://services.leadconnectorhq.com`
- **Auth:** `Authorization: Bearer <token>` — OAuth 2.0 access token or a Private
  Integration Token (PIT).
- **Version header (required):** `Version: 2021-07-28` for Conversations;
  **`Version: v3` for Voice AI** endpoints.
- **Rate limits (per app, per resource):** burst 100 req / 10s; 200,000 req / day.
  Headers: `X-RateLimit-Remaining`, `X-RateLimit-Daily-Remaining`, etc.

## OAuth 2.0 (marketplace app)
- **Authorize:** `https://marketplace.leadconnectorhq.com/oauth/chooselocation?response_type=code&redirect_uri=<uri>&client_id=<id>&scope=<space-separated>`
- **Token:** `POST https://services.leadconnectorhq.com/oauth/token`
  (`client_id`, `client_secret`, `grant_type=authorization_code`, `code`,
  `user_type=Location|Company`, `redirect_uri`). Access tokens last ~24h; refresh
  with `grant_type=refresh_token`.
- **Agency→location token:** `POST /oauth/locationToken` with `companyId`+`locationId`.

## Embedding + SSO context (Custom Page)
1. App iframe posts `window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*')`.
2. GHL replies with `message === 'REQUEST_USER_DATA_RESPONSE'` carrying an
   **AES-encrypted** blob.
3. **Backend** decrypts with the app's **Shared Secret** (never client-side).
   Decrypted fields: `userId`, `companyId`, `role`, `type` (`agency|location`),
   `userName`, `email`, `activeLocation`, `isAgencyOwner`, …
- Client half implemented in `client/src/lib/ghlContext.js`; the decrypt route is
  where the real Shared Secret would live server-side (stubbed for this build).

## Voice AI (Agent Studio)
- **List agents:** `GET /voice-ai/agents?locationId=...` — `Version: v3`.
- **Get agent:** `GET /voice-ai/agents/{agentId}` — `Version: v3`.
- **Actions/goals:** CRUD under the agent; scopes `voice-ai-agent-goals.*`.
- Agent object carries prompt/voice/goal config. *Field-by-field schema not
  exposed verbatim → reconstructed in `normalizeAgent()`.*

## Calls + transcripts
- **List call logs:** `GET /voice-ai/dashboard/call-logs` — `Version: v3`. Filter
  by agent/contact/type/date; paginated. Returns call logs incl. transcript refs.
  *Call-log field schema partly reconstructed in `normalizeCall()`.*
- **Get transcription:** `GET /conversations/locations/{locationId}/messages/{messageId}/transcription`
  — `Version: 2021-07-28`. *Segment array shape (speaker/text/start/end) NOT
  exposed verbatim → this is the highest-risk mapping; isolated in
  `normalizeTranscript()`.*
- **Get recording:** `GET /conversations/messages/{messageId}/locations/{locationId}/recording`
  — returns `audio/x-wav` **binary**, not a JSON URL.
- **Conversations messages:** `GET /conversations/{conversationId}/messages` —
  call messages have `messageType: TYPE_CALL`; fields incl. `direction`,
  `dateAdded`, `callDuration`, `callStatus`, `attachments[]`, `contactId`.

## Webhooks (real-time ingestion)
- `InboundMessage`, `OutboundMessage` — an `OutboundMessage` with
  `messageType: TYPE_CALL` + `callDuration`/`callStatus` is the "call completed"
  signal. Also `ConversationUpdate`, `ProviderOutboundMessage`.
- Production wiring: webhook → enqueue → fetch transcript → run analysis → push to
  dashboard over SSE. (This build simulates the "call completed → analyze" step
  via the `/api/analyze` run.)

## Scopes (read-only observability set)
`conversations.readonly`, `conversations/message.readonly`, `contacts.readonly`,
`voice-ai-dashboard.readonly`, `voice-ai-agents.readonly`,
`voice-ai-agent-goals.readonly`.
> Note: there is **no** `calls.readonly` scope — voice call data comes via the
> Voice AI dashboard scope or the conversations/message scopes.

## Sources
- OAuth 2.0 · Scopes · User Context · Custom Pages — marketplace.gohighlevel.com/docs
- Voice AI Public APIs — help.gohighlevel.com/support/solutions/articles/155000006379
- List Call Logs — marketplace.gohighlevel.com/docs/ghl/voice-ai/get-call-logs
- Get Message Transcription / Recording — marketplace.gohighlevel.com/docs/ghl/conversations/*
- Rate limits — marketplace.gohighlevel.com/docs/oauth/Faqs
