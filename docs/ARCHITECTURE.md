# Voice AI Observability Copilot — Architecture & Plan

> HighLevel FSB assignment · "Team of One" build (Product · Design · Engineering · QA)

## 1. The problem, restated

HighLevel accounts run **Voice AI agents** that take/make calls from a script + goal.
Today, checking whether those agents actually *work* means a human opening call after
call, reading transcripts, and judging "did this go well?" against the agent's intent.
That doesn't scale, it's inconsistent, and problems (a bad prompt, a missed booking, a
compliance slip) are found days later — if at all.

The Copilot replaces that manual audit with an automated **Validation Flywheel**:

```
        ┌──────────────────────────────────────────────────────────┐
        │                                                            │
        ▼                                                            │
   INGEST calls ──▶ DEFINE criteria ──▶ SCORE each call ──▶ SURFACE issues
   (transcripts)     (per-agent KPIs)     (AI + rules)       + recommendations
        ▲                                                            │
        │                                                            ▼
        └──────────── APPLY fix to prompt / re-monitor ◀───── ACT (human-in-loop)
```

Two loops, exactly as the brief frames them:

- **Monitor** — ingest transcripts, define success criteria from the agent's goal/script,
  detect deviations / failures / missed opportunities.
- **Analyze** — a unified dashboard of issues + AI recommendations for fixes + "Use
  Actions" that point to the exact call segments needing a human.

## 2. Product thinking (what makes this *useful*, not just a log viewer)

1. **Criteria are per-agent and derived from the agent's own script/goal**, not a generic
   checklist. A "book a viewing" agent is judged on bookings; a "qualify lead" agent on
   qualification questions asked. The user can edit these.
2. **Every finding is actionable.** A finding is never "call went badly" — it's
   *"Agent didn't confirm the appointment time (turn 14). 7 of 21 calls show this.
   Suggested prompt edit: …"* with a one-click way to see the segment.
3. **Aggregate → drill down.** The dashboard leads with account-level health (which agents
   are failing, on which KPIs, trending which way), then lets you drill into one agent,
   then one call, then one turn. Observability is useless if you can't get from "something
   is wrong" to "here is the line" in two clicks.
4. **Recommendations close the loop.** The AI proposes a concrete prompt/script change and
   shows *which failing calls it would have fixed* — the "flywheel" framing.

## 3. System architecture

```
┌────────────────────── HighLevel account (customer) ──────────────────────┐
│  Custom Menu Link / Custom Page  ──iframe──▶  Copilot UI (Vue 3, embedded) │
│         │ postMessage SSO handshake (encrypted user/location context)      │
└─────────┼──────────────────────────────────────────────────────────────── ┘
          │ HTTPS (locationId, JWT)
          ▼
┌───────────────────────── Copilot backend (Node/Express) ──────────────────┐
│                                                                            │
│  ┌───────────────┐   ┌────────────────────┐   ┌──────────────────────┐    │
│  │ GHL Adapter   │   │ Criteria Engine     │   │ Analysis Engine       │   │
│  │ (interface)   │──▶│ per-agent KPIs      │──▶│ deterministic rules   │   │
│  │  • MockAdapter│   │ derived from goal/  │   │  + LLM (free-tier)    │   │
│  │  • LiveAdapter│   │ script; editable    │   │  = findings + recs    │   │
│  └───────────────┘   └────────────────────┘   └──────────────────────┘    │
│         │ transcripts, agents, calls                     │ scored calls    │
│         ▼                                                 ▼                 │
│  ┌────────────────────────────── Store ────────────────────────────────┐  │
│  │ agents · calls · criteria · findings · recommendations (JSON/in-mem) │  │
│  └─────────────────────────────────────────────────────────────────────┘ │
│         ▲                                                                   │
│  REST + SSE ── /api/agents /api/calls /api/analysis /api/recommendations   │
└────────────────────────────────────────────────────────────────────────── ┘
```

### Key design decision: the **GHL Adapter interface**

All HighLevel access goes through one interface (`listAgents`, `listCalls`,
`getTranscript`, `subscribeCallEvents`). Two implementations:

- **`MockAdapter`** (default) — reads realistic sample data shaped like real GHL payloads.
  The whole app runs and demos with **zero credentials**.
- **`LiveAdapter`** — real HighLevel REST calls + OAuth. Selected via one env var.

This is the honest answer to "GHL access is not sure": the product is fully functional and
demoable today, and going live is a one-file swap, not a rewrite. The README's
**mocked-vs-real matrix** states exactly where the seam is.

### Key design decision: the **Analysis Engine** (free-key friendly)

The engine has two layers behind one `analyzeCall(call, criteria)` interface:

- **Deterministic analyzer** (no API key) — rule/heuristic checks against criteria
  (keyword/goal detection, required-step presence, sentiment proxy, dead-air, objection
  handling). Runs out-of-the-box so the demo never depends on a paid key.
- **LLM analyzer** (optional, free tiers) — Google Gemini free tier or Groq (free) via a
  provider adapter. Produces richer, natural-language findings + prompt rewrites.
  Enabled by dropping a free key in `.env`; otherwise silently falls back to deterministic.

Both emit the **same structured `Finding` / `Recommendation` shape**, so the UI and
the "flywheel" logic don't care which produced them.

## 4. Data model (mirrors real GHL shapes — see §6)

- **VoiceAgent** — id, name, goal, script/prompt, KPIs/criteria.
- **Call** — id, agentId, contactId, direction, startedAt, duration, outcome, recordingUrl.
- **Transcript** — callId, turns[] `{ role: 'agent'|'customer', text, startMs, endMs }`.
- **Criterion** — id, agentId, label, type (`required_step`|`goal`|`compliance`|`kpi`),
  detector config, weight.
- **Finding** — callId, criterionId, status (`pass`|`fail`|`missed`), severity, turnRef,
  evidence, explanation.
- **Recommendation** — agentId, target (`prompt`|`script`|`config`), rationale,
  suggestedChange, affectedCallIds (the flywheel proof).

## 5. Team-of-One ownership (how one person covers 4 hats)

- **Product** — scoped to the two loops the brief names; ruthlessly cut anything that
  isn't "raw log → actionable rec." Criteria-per-agent is the product bet.
- **Design** — one dashboard, three depths (account → agent → call). Findings carry
  color-coded severity; "Use Actions" are literal jump-to-turn links.
- **Engineering** — adapter + engine interfaces isolate the two risky externalities (GHL
  API access, paid LLM keys) so neither blocks a working build.
- **QA** — mock dataset is authored to include known-good, known-bad, and edge cases;
  deterministic analyzer is unit-tested (`server/test/`, 9 tests) with fixed expected
  findings (no LLM flakiness); `server/src/smoke.js` exercises the full pipeline headless.

## 6. Mocked vs. real (honesty matrix — finalized in README)

| Capability | This build | Path to production |
|---|---|---|
| Transcript ingestion | Mock adapter over realistic sample data | LiveAdapter → GHL Conversations/Calls API |
| Real-time updates | SSE over mock event stream | GHL webhooks → same SSE |
| Criteria engine | Real, works on any transcript | unchanged |
| Deterministic analysis | Real | unchanged |
| LLM analysis | Real when a free key is set | swap model/provider |
| Embedding in GHL | Custom Page iframe + SSO handshake stub | register marketplace app |

*Field-level payload shapes, endpoint paths, `Version` headers, scopes, and rate limits
from the API grounding pass are documented in [`GHL-API.md`](GHL-API.md).*
