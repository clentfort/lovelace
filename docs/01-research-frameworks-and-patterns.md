# Research: Agent Frameworks & Patterns for an Always-On Engineering Assistant

## 1) Research goal

Identify architecture patterns and framework choices for building a **human-in-the-loop, always-on assistant** that can:
- work across many repos,
- search/act on Jira, Slack, GitHub effectively,
- maintain durable memory over time,
- run mostly in terminal workflows.

## 2) Sources used

### Pi docs and examples
- `README.md`
- `docs/extensions.md`
- `docs/sdk.md`
- `docs/skills.md`
- `docs/packages.md`
- `examples/README.md`
- `examples/sdk/README.md`

### DeepWiki research targets
- `https://deepwiki.com/mikeyobrien/rho`
- `https://deepwiki.com/openclaw/openclaw`

### Local tool context
- `~/Code/Slackline/README.md`
- Existing Pi skills for `jira`, `lido-cli`, `sonar-sweep-cli`

---

## 3) Key findings from rho

`rho` is highly relevant because it is explicitly built as a Pi-based “always-on” system.

### Strong ideas worth reusing
1. **Event-sourced memory on disk**
   - append-only memory log (`brain.jsonl`), plus derived/materialized state.
   - helps auditability, replay, and robust recovery.

2. **Heartbeat loop for autonomy**
   - periodic check-ins can process pending context and generate next actions.
   - avoids requiring constant manual prompting.

3. **Separation of concerns**
   - core runtime via Pi,
   - extensions for behavior,
   - skills for procedural playbooks,
   - config sync layer.

4. **“User sits on the loop” principle**
   - practical framing for human-in-the-loop: user is governor, not micromanager.

### Risks/limits to watch
- Complexity can grow quickly once heartbeat, web UI, Telegram/email, and package sync are all introduced.
- Must avoid over-building autonomy before trust/safety controls are proven.

---

## 4) Key findings from openclaw

`openclaw` is a multi-channel AI gateway pattern (channels + central orchestration).

### Strong ideas worth reusing
1. **Unified gateway abstraction for channels/tools**
   - consistent architecture for Slack/Telegram/etc integrations.

2. **Hybrid memory retrieval**
   - vector + BM25 pattern for practical semantic + lexical recall.
   - supports searching both notes and session transcripts.

3. **Policy-based tool allow/deny + sandboxing**
   - clean approach to safe execution boundaries.

4. **Session isolation per user/channel**
   - avoids context bleeding and keeps traceability.

### Risks/limits to watch
- Gateway-first architecture may be overkill for a single-user personal workflow initially.
- Docker sandbox complexity may slow early iteration unless needed by policy immediately.

---

## 5) What Pi gives you natively (important)

Pi already covers many primitives needed for this project:

1. **Extension hooks** (`docs/extensions.md`)
   - intercept tool calls (`tool_call`), modify results (`tool_result`), inject context (`before_agent_start`, `context`), custom commands, UI widgets/status.

2. **Programmatic embedding** (`docs/sdk.md`)
   - `createAgentSession()` for running Pi in your own daemon/service process.

3. **Skill system** (`docs/skills.md`)
   - ideal for operational runbooks and standardized procedures.

4. **Package model** (`docs/packages.md`)
   - lets you distribute your lovelace as an installable Pi package.

5. **Modes**
   - interactive (tmux-native), print/json, RPC/SDK for integrations.

**Conclusion:** You do not need to fork Pi core. Build via extension + SDK daemon + skills.

---

## 6) Comparative summary

| Candidate | Memory approach | Tool integration | Human-in-loop pattern | Fit for your use case |
|---|---|---|---|---|
| **Pi (base)** | session history + extension-defined state | excellent (extensions + tools + SDK) | custom via hooks/commands | **Excellent foundation** |
| **rho** | event-sourced brain + vault + heartbeat | Pi extension ecosystem | explicit user-on-loop philosophy | **Best reference for autonomy+memory on Pi** |
| **openclaw** | hybrid retrieval (vector+BM25), workspace+sessions | gateway/plugin architecture, strong policy controls | configurable policies and channel isolation | **Great reference for channel/tool policy architecture** |
| LangGraph (general) | graph state + checkpoints | broad Python ecosystem | explicit interrupt/approval nodes | good conceptual reference, different stack |
| AutoGen (general) | conversation-driven multi-agent memory | broad tool calling support | human proxy and approval patterns | useful but may introduce avoidable complexity early |

---

## 7) Recommended architecture direction

Use a **hybrid of rho-style + openclaw-style ideas**, implemented in Pi-native ways:

1. **Pi extension package** as primary runtime customization.
2. **Small background daemon** (SDK-based) for polling + triage loop.
3. **Event-sourced memory log + indexed retrieval** for cross-repo recall.
4. **Tool adapters** that wrap existing CLIs (`gh`, `jira`, `slackline`, `sonar-sweep`, `lido-cli`).
5. **Mandatory approval gates** for write/mutate actions.

---

## 8) Design patterns to adopt immediately

1. **Read-first / write-guarded**
   - default actions are read-only.
   - writes require explicit proposal + approval.

2. **Proposals as first-class objects**
   - every recommended action has rationale, source signals, expected impact, rollback notes.

3. **Memory as evidence, not magic**
   - keep provenance for each memory item (source + timestamp + confidence).

4. **Repo profile + transferable habits**
   - maintain a lightweight profile per repo (build/test commands, branch strategy, PR norms).
   - apply shared patterns across similar repos.

5. **Progressive autonomy**
   - Phase 1: suggest-only
   - Phase 2: auto-execute low-risk reads
   - Phase 3: delegated writes behind strict policy + approval.

---

## 9) Immediate recommendation

Start with a narrow but high-value target:

> **Cross-repo memory + federated search across Jira/Slack/GitHub**

Reason: this directly addresses your most painful current bottleneck (manual context gathering) and builds the core substrate needed for later autonomy.
