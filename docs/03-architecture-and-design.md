# Architecture & Technical Design

## 1) Architecture choice

**Recommended:** Pi extension package + SDK daemon + local memory/index store.

Why:
- Pi extensions give first-class hooks for tool gating, prompts, and custom commands.
- Pi SDK enables background/embedded execution without hacking Pi core.
- Keeps terminal UX native and incremental.

## 2) High-level components

1. **work-agent extension (Pi package)**
   - slash commands (`/triage`, `/inbox`, `/plan`, `/approve`)
   - tool guards (`tool_call` interception)
   - UI status/widgets for pending proposals

2. **work-agent daemon (SDK session runner)**
   - polling/ingestion loop for external signals
   - proposal generation job
   - writes to local event store

3. **adapter layer (CLI wrappers)**
   - GitHub (`gh`)
   - Jira (`jira`)
   - Slack (`slackline`)
   - pluggable adapters for sonar/lido/infra later

4. **memory subsystem**
   - append-only event log (`events.jsonl`)
   - materialized SQLite store
   - FTS + vector index for hybrid retrieval

5. **policy/approval engine**
   - action classification (read-only / mutate / destructive)
   - approval requirements
   - execution + post-check verification

## 3) Proposed local data layout

```text
~/.work-agent/
  config.toml
  policies.toml
  events/
    events.jsonl
    approvals.jsonl
  memory/
    memory.sqlite
    embeddings.sqlite (or unified)
  cache/
    source-sync-state.json
  proposals/
    queue.jsonl
```

## 4) Canonical data models (initial)

### WorkSignal
- `id`
- `source` (`slack|jira|github|calendar|email|...`)
- `externalId`
- `type` (mention, review_request, ticket_update, etc.)
- `title`
- `text`
- `url`
- `repo` (optional)
- `timestamp`
- `rawRef`

### MemoryEntry
- `id`
- `kind` (`preference|fact|task|decision|pattern|repo_profile`)
- `content`
- `tags[]`
- `repoScope` (`repo-a|global|team-x`)
- `sourceRefs[]`
- `confidence`
- `createdAt`, `lastValidatedAt`, `expiresAt?`

### ActionProposal
- `id`
- `priority`
- `title`
- `why`
- `evidence[]`
- `suggestedActions[]`
- `riskLevel` (`low|medium|high`)
- `requiresApproval` (bool)
- `status` (`new|approved|executed|rejected|failed`)

## 5) Memory strategy (cross-repo critical path)

### 5.1 Storage pattern
- Use append-only JSONL event log as source of truth.
- Build materialized views for fast retrieval.

### 5.2 Retrieval
- Hybrid ranking:
  - lexical (FTS/BM25) for exact IDs/terms,
  - semantic vectors for fuzzy/project-pattern recall.

### 5.3 Repo similarity
- Compute lightweight repo fingerprints:
  - language stack,
  - build/test tools,
  - folder patterns,
  - CI/deploy signatures.
- Use fingerprint similarity to suggest known workflows across repos.

### 5.4 Memory hygiene
- periodic consolidation job (merge duplicates, retire stale memory)
- confidence decay for unconfirmed assumptions
- explicit user correction commands (`/memory fix`, `/memory pin`)

## 6) Human-in-the-loop model

### Action classes
1. **Read-only** (safe): can auto-run.
2. **Mutating** (comment/transition/post): approval required.
3. **Destructive/high-risk**: explicit confirmation + optional dry run.

### Approval payload
Every approval request should include:
- exact command/tool plan,
- target object(s),
- expected side effects,
- rollback option (if available).

## 7) Pi integration points

Use these extension hooks heavily:
- `before_agent_start`: inject triage context and memory snippets.
- `tool_call`: apply policy and gate risky actions.
- `tool_result`: normalize outputs and persist structured event records.
- custom commands: `/triage`, `/search`, `/proposals`, `/approve`.

Use SDK for daemon loop:
- `createAgentSession()` for embedded runs,
- queue prompts (`steer`, `followUp`) for controlled processing,
- subscribe to events for observability.

## 8) Security model

1. Principle of least privilege per adapter credential.
2. Token storage separated by source, encrypted at rest where possible.
3. Strict allow/deny command patterns for tool wrappers.
4. Audit log for all mutating operations.
5. Optional sandbox mode in later phase for execution hardening.

## 9) Observability

- structured logs per proposal/action
- per-source sync lag metrics
- approval latency and failure-rate dashboards (CLI summary initially)

## 10) Why this is incremental

This design lets you ship value in layers:
- first search + memory,
- then proposal quality,
- then controlled execution,
- then more channels and richer autonomy.
