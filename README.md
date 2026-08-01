# Voice AI Observability Copilot

An **Agent Observability Copilot** for HighLevel Voice AI agents. It automates the
**Monitor** and **Analyze** phases of running voice agents: ingest call transcripts,
score them against per-agent success criteria, surface the failures and missed
opportunities on a unified dashboard, and generate concrete recommendations to fix
the agent's prompt/script — the **Validation Flywheel**.

> Built as a "team of one" for the HighLevel FSB assignment. Node.js backend +
> Vue 3 frontend. Runs end-to-end with **zero credentials** (mock GHL data +
> deterministic analysis), and upgrades to real HighLevel APIs and a free-tier LLM
> by setting env vars.

---

## What it does

```
 INGEST transcripts ─▶ DEFINE criteria ─▶ SCORE each call ─▶ SURFACE issues ─▶ RECOMMEND fixes ─┐
   (GHL adapter)        (per-agent KPIs)   (rules + LLM)      (dashboard)       (prompt edits)   │
        ▲                                                                                         │
        └──────────────────────── re-monitor after applying the fix ◀────────────────────────────┘
```

- **Monitor** — ingests Voice AI call transcripts, derives success criteria from each
  agent's goal/script (editable), and flags deviations, failures, and missed
  opportunities against those KPIs.
- **Analyze** — a unified dashboard (account → agent → call), AI-generated
  recommendations for prompt/script fixes, and **Use Actions**: the exact call
  segments needing a human, ranked by severity.
- **Validate before you ship** — a recommended prompt edit can be tested against
  generated adversarial calls *before* it is saved, so the loop closes without
  waiting for the next batch of real traffic.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design and
[`docs/GHL-API.md`](docs/GHL-API.md) for the verified HighLevel API grounding.

---

## Quick start (zero setup)

Requires Node 18+. Two terminals:

```bash
# 1) Backend  (http://localhost:3001)
cd server
npm install
npm start

# 2) Frontend (http://localhost:5173)
cd client
npm install
npm run dev
```

Open **http://localhost:5173**. The backend seeds and analyzes the mock dataset on
boot, so the dashboard has data immediately. No API keys, no HighLevel account
needed.

> If `npm install` in `client/` reports esbuild's install script was skipped, run
> `npm approve-scripts esbuild` (an allow-scripts policy blocks postinstall by
> default), then `npm run dev`.

---

## Enabling the real integrations (optional)

Copy `server/.env.example` to `server/.env` and set only what you want.

### Real HighLevel data
```env
GHL_MODE=live
GHL_ACCESS_TOKEN=<OAuth token or Private Integration Token>
GHL_LOCATION_ID=<sub-account location id>
```
This swaps `MockAdapter` for `LiveAdapter`, which calls the real Voice AI + and
Conversations endpoints (see `docs/GHL-API.md`). Everything downstream is unchanged.

### Real AI analysis (free tiers)
```env
LLM_PROVIDER=gemini          # or: groq
GEMINI_API_KEY=<free key from https://aistudio.google.com/apikey>
# GROQ_API_KEY=<free key from https://console.groq.com/keys>
```
With no key, the **deterministic** analyzer runs (rule-based, fully functional).
With a key, the LLM writes richer recommendations *and* authors the synthetic test
calls used by **Test prompt** (see below). Both emit the same shapes, so the UI is
identical either way. The active engine is shown in the app footer.

### Installing inside a HighLevel sandbox (Custom Page)
1. Create a Marketplace app (sandbox) at the HighLevel Marketplace.
2. Add a **Custom Page** / **Custom Menu Link** pointing at this frontend's URL.
3. Add OAuth scopes (read-only): `voice-ai-agents.readonly`,
   `voice-ai-dashboard.readonly`, `voice-ai-agent-goals.readonly`,
   `conversations.readonly`, `conversations/message.readonly`, `contacts.readonly`.
4. On load the app performs the `postMessage` SSO handshake to obtain the location
   context (`client/src/lib/ghlContext.js`); the encrypted blob is decrypted
   server-side with the app's Shared Secret.

---

## Functional vs. mocked (honesty matrix)

| Capability | Status in this build | Path to production |
|---|---|---|
| Transcript ingestion | ✅ Real over a **mock GHL dataset** shaped like real payloads | Set `GHL_MODE=live` → `LiveAdapter` hits real endpoints |
| Criteria/KPI engine | ✅ Real — works on any transcript, editable per agent | unchanged |
| Deterministic analysis + scoring | ✅ Real | unchanged |
| LLM recommendations | ✅ Real **when a free key is set**; deterministic fallback otherwise | swap provider/model |
| Dashboard, drill-down, Use Actions | ✅ Real | unchanged |
| Synthetic prompt testing | ✅ Real scoring — scenarios are LLM-authored with a key, keyword-templated without one (the panel says which) | unchanged; quality tracks the model |
| Saving an edited prompt | ⚙️ **Mock mode only** — `PUT /api/agents/:id/prompt` writes to the local dataset and returns 501 in live mode | needs a verified HighLevel agent-update endpoint (see `docs/GHL-API.md`) |
| Real-time updates | ⚙️ Not built — re-analysis is triggered by `POST /api/analyze` | GHL `OutboundMessage` webhook → same pipeline |
| GHL embed / SSO | ⚙️ Client handshake implemented; server-side decrypt **stubbed** | add Shared Secret + `/decrypt` route |
| Live-endpoint field mapping | ⚠️ Transcript-segment schema is **reconstructed** (GHL docs don't expose it) | verify against a live response — isolated in `normalizeTranscript()` |
| Backend-less (static) deploy | ⚙️ Falls back to a **pre-computed snapshot** in `client/public/data`; the footer says so and labels the recorded engine "not running" | deploy the backend (see `render.yaml` / `Dockerfile`) |

Nothing is faked silently: the app footer and this table state exactly what's live.

---

## How the analysis works

1. **Criteria** (`server/src/analysis/criteria.js`) — each agent gets a starter set
   of criteria derived from its goal/script (e.g. a booking agent gets "offers to
   book" + "appointment confirmed"; a compliance-sensitive agent gets an "avoid
   guarantees" guardrail). Criteria are weighted and editable via the API.
2. **Scoring** (`server/src/analysis/deterministic.js`) — each criterion has a
   transparent detector (required step present, forbidden phrase, question asked,
   customer confirmation). Matching is governed by **four named rules**, one function
   each, so any wrong verdict traces to exactly one of them:
   `findKeywordAll` (whole word, every occurrence — "yes" ≠ "yesterday", and a negated
   mention can't mask a real one later), `negatedBefore` (negation, current clause only —
   "I can't guarantee…" is compliant, "No, I guarantee it" is not), `insideQuestion`
   ("Can you confirm the price?" is asking, not agreeing) and `DECLINE_OPENER`
   ("No thanks, I'm okay" declines). Findings are
   `pass | fail | missed` with severity, the exact turn, and an evidence quote.
   Score = weighted % of criteria passed, or `null` ("not scored") when an agent has no
   scorable criteria.
3. **Severity gating** (`server/src/analysis/severity.js`) — a failed `critical`
   criterion caps the score at 39 and a failed `high` at 69, applied at **call, agent and
   account level**, so a compliance violation can never be averaged into a healthy-looking
   number. The ungated mean is kept alongside (`rawScore` / `rawAvgScore`) for trends.
   Editing criteria re-scores that agent immediately, so findings and recommendations can
   never refer to criteria that no longer exist.
4. **Recommendations** (`server/src/analysis/recommend.js`) — failures are
   aggregated per agent; the engine proposes a concrete prompt/script edit and
   lists **which calls it would have fixed** (the flywheel payoff). LLM-authored
   when a key is present, templated otherwise.
5. **Synthetic validation** (`server/src/analysis/synthetic.js`) — generates adversarial
   test calls for a *draft* prompt and scores them with the same engine, so a suggested
   fix can be checked before it is saved (detailed next).

### Testing a prompt before you save it

A recommendation tells you what to change. **Test prompt**, on the agent page next to
**Save**, tells you whether the rewrite actually works — without waiting for the next
batch of real calls.

It sends the **unsaved draft**, so you are testing exactly what you are about to save.
The backend asks the LLM for 4–6 short customer/agent transcripts built from the agent's
goal and that draft prompt, with **at least one adversarial scenario per failing
criterion** (a customer who pushes for a guarantee, one who never confirms, and so on).
Each generated call is then scored by the **same `deterministic.js` engine that scores
real calls** — no second scoring path to keep in sync — and the panel below the button
shows every transcript with a pass/fail row per criterion.

With no LLM key the scenarios are keyword-templated instead of prompt-aware; the panel
says so rather than implying the draft was really exercised.

```
POST /api/agents/:id/test-prompt   { prompt }   → transcripts + pass/fail per criterion
PUT  /api/agents/:id/prompt        { prompt }   → persist (mock mode only)
```

---

## Team-of-one ownership

- **Product** — scoped hard to the two loops the brief names; the product bet is
  *criteria derived per-agent from its own script*, so findings are relevant not
  generic. Everything that wasn't "raw log → actionable fix" was cut.
- **Design** — one dashboard, three depths (account → agent → call). Severity is
  color-coded; Use Actions are literal jump-to-call links; the violating transcript
  turn is highlighted in place.
- **Engineering** — the two external risks (GHL access, paid LLM keys) are isolated
  behind adapter interfaces so neither can block a working, demoable build.
- **QA** — the mock dataset is authored with known good/fail/missed/compliance
  cases; the deterministic analyzer is verifiable against them. Unit tests
  (`cd server && npm test`, 50 tests in `server/test/`) cover the detector edge cases
  — negation and its clause scope, word boundaries, repeat occurrences, questions vs.
  confirmations, declines, weighted scoring, the null-score sentinel, and the severity
  gate at call / agent / account level. The synthetic generator is tested against a
  **mocked `complete()`**, so the JSON contract and the hand-off into `deterministic.js`
  are verified without spending a token or depending on model output. And
  `server/src/smoke.js` runs the whole pipeline headless (`node src/smoke.js`),
  printing scores, Use Actions, and recommendations for a fast end-to-end check.

---

## Project layout

```
server/                      Node/Express backend
  src/ghl/                   Adapter interface + MockAdapter + LiveAdapter (real endpoints)
  src/analysis/              criteria · deterministic scorer · recommend · metrics
                             synthetic (prompt test scenarios) · severity (score gate)
                             validate (criteria input) · status (shared predicates) · llm/ (providers)
  src/routes/api.js          REST API
  src/smoke.js               headless end-to-end pipeline check
  data/                      mock agents, calls, transcripts (GHL-shaped)
  test/                      unit tests (detector edge cases, synthetic contract)
client/                      Vue 3 + Vite dashboard (embeddable in GHL)
  src/views/                 Overview · AgentDetail (incl. prompt editor) · CallDetail
  src/components/            ScoreBadge · GateNote · PromptTestResult
  src/lib/ghlContext.js      GHL Custom Page SSO handshake
  src/lib/useLoader.js       async loader: request-race guard + error state
docs/                        ARCHITECTURE.md · GHL-API.md
```
