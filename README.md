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
With a key, the LLM writes richer recommendations. Both emit the same shapes, so
the UI is identical either way. The active engine is shown in the app footer.

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
| Real-time updates | ⚙️ Simulated via the `/api/analyze` run | GHL `OutboundMessage` webhook → same pipeline |
| GHL embed / SSO | ⚙️ Client handshake implemented; server-side decrypt **stubbed** | add Shared Secret + `/decrypt` route |
| Live-endpoint field mapping | ⚠️ Transcript-segment schema is **reconstructed** (GHL docs don't expose it) | verify against a live response — isolated in `normalizeTranscript()` |

Nothing is faked silently: the app footer and this table state exactly what's live.

---

## How the analysis works

1. **Criteria** (`server/src/analysis/criteria.js`) — each agent gets a starter set
   of criteria derived from its goal/script (e.g. a booking agent gets "offers to
   book" + "appointment confirmed"; a compliance-sensitive agent gets an "avoid
   guarantees" guardrail). Criteria are weighted and editable via the API.
2. **Scoring** (`server/src/analysis/deterministic.js`) — each criterion has a
   transparent detector (required step present, forbidden phrase, question asked,
   customer confirmation). Findings are `pass | fail | missed` with severity, the
   exact turn, and an evidence quote. Score = weighted % of criteria passed.
3. **Recommendations** (`server/src/analysis/recommend.js`) — failures are
   aggregated per agent; the engine proposes a concrete prompt/script edit and
   lists **which calls it would have fixed** (the flywheel payoff). LLM-authored
   when a key is present, templated otherwise.

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
  cases; the deterministic analyzer is verifiable against them. `server/src/smoke.js`
  runs the whole pipeline headless (`node src/smoke.js`) and prints scores,
  Use Actions, and recommendations for a fast regression check.

---

## Project layout

```
server/                      Node/Express backend
  src/ghl/                   Adapter interface + MockAdapter + LiveAdapter (real endpoints)
  src/analysis/              criteria · deterministic scorer · LLM providers · recommendations · metrics
  src/routes/api.js          REST API
  data/                      mock agents, calls, transcripts (GHL-shaped)
client/                      Vue 3 + Vite dashboard (embeddable in GHL)
  src/views/                 Overview · AgentDetail · CallDetail
  src/lib/ghlContext.js      GHL Custom Page SSO handshake
docs/                        ARCHITECTURE.md · GHL-API.md
```
