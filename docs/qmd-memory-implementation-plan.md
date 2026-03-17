# QMD-backed memory implementation plan

## Goal

Replace the current memory storage/retrieval path with a **local-first qmd-backed memory backend** while keeping the rest of the Lovelace extension practical and small.

The desired end state is:

- all memory data stays on the local machine
- no hosted service is required
- the agent can retrieve relevant memories at turn start
- the extension can silently propose/add memories near `agent_end` and `session_before_compact`
- memory quality is managed with **lightweight governance on write**, not a heavy proposal review system
- task/session/PR linking can remain in the existing local relational store if that keeps integration simpler

This plan assumes qmd is used as the **primary memory document/search engine** and that we keep only the minimal policy needed to avoid memory rot.

---

## Non-goals

For the first implementation, we are **not** trying to build:

- a complex multi-stage proposal review workflow
- hosted/shared/team memory
- autonomous cross-project synchronization
- perfect semantic deduplication
- a full replacement for task/session/PR relational tracking
- a dashboard UI outside of the existing Pi commands/modals

---

## Assumptions to validate first

Before implementation, we need to confirm qmd supports the following locally:

1. **Local persistence**
   - data is stored on disk locally
   - no mandatory remote service

2. **Document CRUD**
   - insert/update/delete documents
   - fetch by id

3. **Metadata filtering**
   - filter by fields such as `scope`, `projectId`, `taskId`, `status`, `archived`

4. **Search**
   - text search and/or semantic search
   - ability to retrieve top-N results with scores

5. **Similarity lookup**
   - enough support to find near-duplicate memories for reinforcement/merge

6. **Node/TypeScript integration**
   - usable from the Pi extension runtime without introducing a service we must manually run

If any of these are missing, we should stop and either:

- fall back to a hybrid model (`SQLite metadata + qmd search index`), or
- choose a different local backend

---

## Recommended architecture

## Split responsibilities

### Keep in the existing relational store

Use the current local store for:

- projects
- tasks
- PRs
- session ↔ task links
- task ↔ PR links
- any small relational state that benefits from exact lookup

This avoids forcing qmd to behave like a graph/relational database.

### Move memory documents to qmd

Use qmd for:

- active memories
- candidate memories
- task continuation summaries
- search/ranking
- similarity lookup during add/update

This makes qmd the memory system while keeping the proven local task/session model intact.

---

## Memory model

We will use a **single memory document model** with lightweight status metadata.

### Memory statuses

- `candidate` — newly extracted or weakly supported memory
- `active` — trusted enough to retrieve by default
- `stale` — old memory that should be down-ranked or hidden unless highly relevant
- `archived` — explicitly hidden from normal retrieval

This is intentionally smaller than the earlier proposal/governance model.

### Memory scopes

- `user`
- `project`
- `domain`
- `task`

### Memory kinds

Reuse the existing taxonomy:

- `preference`
- `structure`
- `workflow`
- `constraint`
- `command`
- `gotcha`
- `note`

### Proposed qmd document shape

```ts
interface MemoryDocument {
  id: string;
  text: string;
  textCanonical: string;

  scope: "user" | "project" | "domain" | "task";
  kind: "preference" | "structure" | "workflow" | "constraint" | "command" | "gotcha" | "note";
  status: "candidate" | "active" | "stale" | "archived";
  source: "manual" | "scan" | "llm" | "heuristic";

  projectId: string | null;
  projectKey: string | null; // stable repo/root identifier
  taskId: string | null;
  taskRef: string | null;

  confidence: number; // current confidence [0..1]
  supportCount: number; // number of times this memory was reinforced
  distinctSessionCount: number;
  distinctTaskCount: number;

  createdAt: number;
  updatedAt: number;
  firstSeenAt: number;
  lastSeenAt: number;
  lastUsedAt: number | null;
  archivedAt: number | null;

  fingerprint: string; // canonical identity candidate
  evidenceFingerprints: string[]; // bounded, optional if qmd metadata supports arrays
}
```

If qmd metadata is limited, we can keep `evidenceFingerprints` outside qmd in the local relational store and only store aggregate counts inside qmd.

---

## Lightweight governance model

We are not doing heavy manual review, but we still want guardrails on write.

## Add-time policy

Every auto-extracted memory goes through these checks before insertion:

1. **Sanitize**
   - redact obvious secrets/tokens using existing sanitizer logic

2. **Normalize**
   - trim whitespace
   - canonicalize punctuation/casing for dedupe

3. **Scope validation**
   - reject project memory if no current project exists
   - reject task memory if no current task exists

4. **Quality filter**
   - reject too-short or low-information memories
   - reject obvious ephemeral progress updates
   - reject raw command output dumps
   - reject “just happened” messages that are not reusable later

5. **Similarity check**
   - search qmd for similar memories in the same scope/context
   - if a close match exists, reinforce it instead of inserting a duplicate

6. **Status assignment**
   - `manual` writes start as `active`
   - `scan` writes start as `active` or `candidate` depending on confidence
   - `llm` auto-memories start as `candidate` unless confidence/support is high enough

### Simple promotion rules

Promote `candidate -> active` when any of the following is true:

- confidence >= `0.86`
- supportCount >= `3`
- distinctSessionCount >= `2` for task memories
- distinctSessionCount >= `3` for project/domain memories
- manual confirmation via command

### Simple staleness rules

Mark as `stale` when not seen/used recently:

- task: after 14 days
- project: after 90 days
- domain: after 120 days
- user: do not automatically stale unless confidence is very low and never reinforced

### Archival rules

Archive weak stale memories if:

- status is already `stale`
- supportCount <= `1`
- lastSeenAt older than 180 days
- not manually created

This gives us practical degradation control without a large governance system.

---

## Retrieval model

## Before agent start

At `before_agent_start`:

1. detect task from prompt if possible
2. build retrieval context:
   - current project
   - current task
   - prompt text
3. query qmd for relevant memories using:
   - prompt text
   - scope filters
   - `status in (active)` by default
4. optionally include a small number of `stale` memories only if highly relevant
5. mark selected memories as used (`lastUsedAt = now`)
6. format compact memory block and append to the system prompt

## Retrieval filters

Default retrieval should include:

- `user` memories
- current `project` memories
- `domain` memories
- current `task` memories

Default retrieval should exclude:

- `candidate`
- `archived`

Optional review/debug paths may include:

- `candidate`
- `stale`

## Ranking approach

Use qmd result score as the base, then post-rank with metadata:

```text
finalScore =
  qmdScore * 0.60 +
  confidence * 0.15 +
  supportBoost * 0.10 +
  recencyBoost * 0.05 +
  usageBoost * 0.05 +
  scopeBoost * 0.05
```

Where:

- `supportBoost` favors repeatedly reinforced memories
- `recencyBoost` favors recently seen/updated memories
- `usageBoost` favors memories that actually helped recent turns
- `scopeBoost` prioritizes task > project > domain > user when the current query is repo/task-specific

---

## Silent auto-memory flow

We want behavior similar to OpenClaw silent auto memory, but local and small.

## Trigger points

Run auto-memory extraction at:

1. `agent_end`
2. `session_before_compact`
3. optionally `session_before_switch`
4. optionally `session_shutdown`

## Extraction source text

Use serialized conversation text from the current branch/turn, but bounded:

- at most ~20k chars for `agent_end`
- at most ~30k chars for compaction/switch

## Extraction prompt behavior

Ask the LLM to extract only:

- stable, reusable facts
- conventions/tools/workflows/preferences/gotchas
- task-specific memory only when it helps continuation

Explicitly exclude:

- ephemeral progress updates
- raw logs
- one-off shell outputs
- secrets
- temporary failures unless they imply a reusable gotcha

## Write path

For each extracted memory:

1. classify `scope`, `kind`, `text`, `confidence`
2. run add-time governance
3. query qmd for similar memory
4. if similar memory exists:
   - update that memory’s `lastSeenAt`
   - increment support counters
   - raise confidence up to a cap
   - optionally refresh text if new version is clearly better
5. else create a new `candidate`
6. auto-promote if thresholds are met

This keeps the system close to “silent auto memory” while still preventing duplicate spam.

---

## Similarity and deduplication strategy

## Canonical dedupe

First pass dedupe is cheap and deterministic:

- normalize text to lowercase
- strip punctuation and repeated whitespace
- build `textCanonical`
- compare `(scope, project/task context, textCanonical)`

If exact canonical match exists, reinforce it.

## Semantic dedupe

Second pass dedupe uses qmd similarity search:

- query top 5 nearest memories in the same scope/context
- if best similarity exceeds threshold, treat as the same memory

Suggested thresholds:

- `0.93+` exact/near-exact rewording -> merge automatically
- `0.85 - 0.93` probable paraphrase -> merge if kind/scope compatible
- `< 0.85` create new memory

These thresholds should be tuned only after observing real data.

## Text refresh rule

If a new memory is more canonical than the existing one, replace text only if:

- it is shorter or clearer
- meaning is unchanged
- it does not remove important specificity

Otherwise keep original text and only reinforce metadata.

---

## Decay and degradation handling

qmd should be treated as a store/search engine, not as the policy engine.

We will implement memory degradation through metadata maintenance.

## Daily/periodic maintenance pass

Add a maintenance routine that can run:

- on extension startup (lightweight)
- once per day per project/session
- optionally via manual command

Maintenance tasks:

1. mark old active memories as `stale`
2. archive weak stale memories
3. recompute decayed confidence if needed
4. merge near-duplicate candidates discovered later
5. cap evidence/support metadata if it grows too large

## Confidence decay

We should keep decay simple:

- do not aggressively decay manually added memories
- decay weak auto memories slowly if they are never reinforced

Example:

- every 30 days without reinforcement:
  - `candidate`: confidence -0.08
  - `active`: confidence -0.03
- never decay below a floor of `0.35`

When confidence falls below threshold and memory is old, mark it `stale`.

## Reinforcement overrides decay

Whenever a memory is matched again by auto-extraction or selected during retrieval:

- update `lastSeenAt` or `lastUsedAt`
- increase supportCount
- slightly restore confidence
- optionally move `stale -> active` if repeatedly rediscovered

This creates a healthy memory lifecycle:

- repeated memories become durable
- unused memories fade
- weak memories disappear quietly

---

## Integration plan in Lovelace/OpenClaw

## New abstraction

Introduce a backend interface so the extension is not tied directly to SQLite memory storage.

```ts
interface MemoryBackend {
  addMemory(input: AddMemoryInput): Promise<MemoryRecord>;
  reinforceMemory(input: ReinforceMemoryInput): Promise<MemoryRecord>;
  searchMemories(input: SearchMemoryInput): Promise<MemoryRecord[]>;
  getMemoryById(id: string): Promise<MemoryRecord | undefined>;
  archiveMemory(id: string): Promise<void>;
  listMemories(input: ListMemoriesInput): Promise<MemoryRecord[]>;
  runMaintenance(input?: MaintenanceInput): Promise<MaintenanceResult>;
  findSimilarMemory(input: SimilarMemoryInput): Promise<MemoryRecord | undefined>;
}
```

## First backend implementation

Implement:

- `QmdMemoryBackend`

Optionally retain:

- `SQLiteMemoryBackend` only temporarily for migration/testing

## Extension integration points

### `before_agent_start`

- call `memoryBackend.searchMemories(...)`
- render memory block from returned docs

### `agent_end`

- serialize conversation
- extract candidate memories
- call `memoryBackend.addMemory(...)` or `reinforceMemory(...)`

### `session_before_compact`

- same as `agent_end`, but with longer branch context
- still store/update continuation summary

### `/ll:remember`

- write directly through qmd backend
- default to `active`

### `/ll:forget`

- archive via qmd backend

### `/ll:memory`

- search/list through qmd backend
- add support for query text

### `/ll:memory stats`

- implement using qmd metadata aggregation if supported
- otherwise compute in-memory after listing matching docs

### `/ll:memory maintain`

Add a maintenance command for debugging and hygiene.

---

## Command surface

## Keep

- `/ll:remember <scope> <text>`
- `/ll:forget <id>`
- `/ll:memory`
- `/ll:memory stats`
- `/ll:memory scan`

## Add

### `/ll:memory search <query>`

Explicit search over active/stale memories in current context.

### `/ll:memory candidates [query]`

Inspect candidate memories that have not yet promoted.

### `/ll:memory maintain`

Run maintenance and show:

- stale marked count
- archived count
- merged count
- reactivated count

### `/ll:memory debug <id>`

Show full metadata for one memory document:

- scope
- kind
- status
- supportCount
- confidence
- firstSeenAt / lastSeenAt / lastUsedAt
- project/task bindings

---

## Scan integration

`/ll:memory scan` should continue to work, but now it writes into qmd-backed memory docs.

Recommended write policy for scans:

- highly reliable structural facts -> `active`
- weak inferred conventions -> `candidate`

Examples:

- `This repo uses pnpm.` -> `active`
- `Top-level directories include ...` -> likely `candidate`
- generated-code directory fact -> `active` or `candidate` depending on confidence

Scan results should still use dedupe/reinforcement rather than blindly inserting duplicates.

---

## Migration strategy

## Stage 0: capability spike

Build a tiny qmd playground script outside the extension:

- insert docs
- query docs with metadata filters
- update docs
- delete/archive docs
- search by query
- similarity lookup

Do this before changing the extension.

## Stage 1: backend abstraction

Refactor current extension so memory operations go through a `MemoryBackend` interface.

At this stage, still use the current backend underneath.

## Stage 2: qmd backend

Implement `QmdMemoryBackend` and switch:

- `/ll:remember`
- `/ll:forget`
- `/ll:memory`
- auto-memory writes
- retrieval at turn start

Keep task/session/PR state unchanged.

## Stage 3: migration/import

Add a one-time import tool from existing memory rows into qmd docs.

Suggested command:

- `/ll:memory import-sqlite`

Import behavior:

- active -> active
- candidate -> candidate
- archived -> archived
- preserve timestamps and ids if possible

## Stage 4: cleanup

Once stable:

- remove old memory CRUD from SQLite store
- keep only non-memory relational data there
- simplify code paths and tests

---

## Testing plan

## Unit tests

### backend tests

- insert memory
- archive memory
- update/reinforce memory
- canonical dedupe
- semantic dedupe threshold behavior (mock if needed)
- retrieval filters by scope/status/project/task
- maintenance staleness/archival rules

### extraction tests

- extracted stable memory becomes candidate
- high-confidence/manual memory becomes active
- repeated extraction reinforces instead of duplicating

### retrieval tests

- only active memories shown by default
- stale memories hidden unless highly relevant
- task/project scoping works correctly

## integration tests

- `before_agent_start` injects qmd-backed memory block
- `agent_end` creates/reinforces candidate memories
- `session_before_compact` stores continuation summary and updates memory
- `/ll:remember` and `/ll:forget` operate against qmd backend

## manual tests

1. add several project memories manually
2. search them in a later session
3. trigger repeated auto-memory extraction across sessions
4. verify reinforcement instead of duplicate creation
5. run maintenance and inspect stale/archive behavior
6. switch repos and ensure project scoping prevents bleed-through

---

## Observability and debugging

Because silent auto memory can be confusing, add lightweight visibility.

## Notifications

Show non-noisy notifications such as:

- `Added 2 memory candidates`
- `Reinforced 1 existing memory`
- `Promoted 1 memory to active`
- `Maintenance archived 4 stale memories`

## Debug logging

For development mode, log:

- extracted memory count
- dropped memory reasons
- dedupe matches
- promotion decisions
- maintenance actions

## Inspection UI

Support inspection via `/ll:memory debug <id>` and `/ll:memory candidates`.

---

## Risks and mitigations

## Risk: qmd metadata/search API is too limited

Mitigation:

- validate capabilities first in a spike
- fall back to hybrid (`SQLite metadata + qmd search index`) if needed

## Risk: too many low-value auto memories

Mitigation:

- keep strong add-time filters
- default auto memories to `candidate`
- require reinforcement to promote

## Risk: memory degradation hides useful facts too aggressively

Mitigation:

- use `stale` before `archived`
- keep manual memories stable
- make maintenance thresholds conservative initially

## Risk: retrieval quality is noisy

Mitigation:

- combine qmd score with metadata-aware reranking
- cap per-scope results
- prefer active memories only at first

## Risk: migration complexity

Mitigation:

- add backend abstraction before switching storage
- import existing memory rows in one direction only
- keep old relational task/session store unchanged

---

## Suggested implementation phases

## Phase 1 — qmd spike

Deliverable:

- standalone script proving local CRUD/search/filter/update works
- short write-up of qmd capabilities and constraints

## Phase 2 — backend abstraction

Deliverable:

- `MemoryBackend` interface
- extension no longer depends directly on memory-specific SQLite methods

## Phase 3 — qmd memory backend

Deliverable:

- qmd-backed add/search/archive/list
- existing commands wired to it

## Phase 4 — silent auto memory

Deliverable:

- auto extraction at `agent_end` and `session_before_compact`
- candidate/reinforcement/promotion flow

## Phase 5 — degradation/maintenance

Deliverable:

- stale/archive maintenance pass
- maintenance command
- retrieval ranking that respects status and recency

## Phase 6 — migration and cleanup

Deliverable:

- import command from existing memory rows
- old memory-specific SQLite code removed or isolated

---

## Acceptance criteria

The implementation is successful when:

1. memory stays fully local
2. no hosted service is needed
3. the agent can retrieve relevant memories in later sessions
4. auto-memory extraction creates useful candidate memories without spamming duplicates
5. repeated memories become stronger over time
6. old weak memories quietly degrade/archive
7. unrelated project memories do not bleed into the current repo
8. manual memory management remains simple (`remember`, `forget`, `search`, `maintain`)

---

## Open questions to answer before build

1. What exact qmd API surface is available from Node/TypeScript?
2. Does qmd support metadata updates efficiently, or do we need delete/reinsert semantics?
3. Can qmd do similarity lookup directly, or do we need our own fallback?
4. Are array-like metadata fields supported, or should evidence counters live elsewhere?
5. Should task continuation summaries live in qmd too, or remain separate?
6. Do we want `candidate` memories visible anywhere by default, or only via explicit commands?
7. Is import of existing memory rows required for v1, or can we start fresh?

---

## Recommended first build slice

If we want the smallest useful version first, implement only this:

1. qmd capability spike
2. `MemoryBackend` abstraction
3. qmd-backed `add/search/archive/list`
4. retrieval at `before_agent_start`
5. silent auto-memory at `agent_end`
6. statuses: `candidate`, `active`, `archived`
7. simple reinforcement by canonical match

Then add:

- semantic dedupe
- maintenance/staleness
- compaction-triggered extraction
- migration

That path gives a usable local memory system early while keeping the architecture compatible with the fuller plan above.
