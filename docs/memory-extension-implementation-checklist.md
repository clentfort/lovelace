# Memory Extension v1 — Implementation Checklist

## Phase 0 — Project setup
- [x] Create extension package under `extensions/memory/`
- [x] Add `package.json`
- [x] Decide SQLite library (`better-sqlite3`)
- [x] Add migration/bootstrap step for local DB
- [x] Choose DB path (`~/.lovelace/memory.db`)

## Phase 1 — Core data model
- [x] Create schema for `projects`
- [x] Create schema for `memories`
- [x] Create schema for `tasks`
- [x] Create schema for `pi_sessions`
- [x] Create schema for `prs`
- [x] Create schema for `edges`
- [x] Add indexes for common lookups:
  - [x] project by `root_path`
  - [x] task by `ref`
  - [x] session by `session_file`
  - [x] edges by `from_*` and `to_*`

## Phase 2 — Extension skeleton
- [x] Register extension entrypoint
- [x] Implement `session_start` hook
- [x] Implement `before_agent_start` hook
- [x] Implement `tool_result` observation hook
- [x] Add minimal in-memory runtime state:
  - [x] current project
  - [x] current task
  - [x] current pi session record

## Phase 3 — Project detection
- [x] Detect git root
- [x] Detect repo name
- [x] Detect git remote if available
- [x] Upsert project record in DB
- [x] Link current Pi session to project

## Phase 4 — Pi session registration
- [x] Read current Pi session file/path if available
- [x] Create/update `pi_sessions` row
- [x] Store session file reference, not full transcript
- [x] Restore prior task link for same session if it exists

## Phase 5 — Manual commands
- [x] `/memory`
- [x] `/remember <scope> <text>`
- [x] `/forget <id>`
- [x] `/task <ref> [summary]`
- [x] `/task clear`
- [x] `/task show`
- [x] `/pr <number|url>`
- [x] `/memory scan`

## Phase 6 — Stable memory CRUD
- [x] Insert manual memories
- [x] List relevant memories
- [x] Archive/remove memories
- [x] Support scopes:
  - [x] user
  - [x] project
  - [x] domain
  - [x] task

## Phase 7 — Task handling
- [x] Create/upsert task by ref
- [x] Link current session to task
- [x] Store optional title/summary
- [x] Show current task in `/task show`
- [x] Persist task context in runtime/session state

## Phase 8 — PR handling
- [x] Parse PR number input
- [x] Parse PR URL input
- [x] Create/upsert PR row
- [x] Link PR to current task
- [x] Link PR to current session when applicable

## Phase 9 — Heuristic extraction
- [x] Detect task refs from prompt text
- [x] Detect task refs from branch name
- [x] Detect task refs from `jira` CLI usage/output
- [x] Detect PR refs from `gh pr` usage/output
- [x] Detect repeated successful commands
- [x] Create candidate project memories from repeated successful commands

## Phase 10 — Repo scan
- [x] Scan top-level manifests/config files
- [x] Detect package manager
- [x] Detect workspace/monorepo shape
- [x] Detect likely important dirs
- [x] Detect likely generated-code dirs
- [x] Save findings as project memories

## Phase 11 — Retrieval
- [x] Retrieve relevant user memories
- [x] Retrieve relevant project memories
- [x] Retrieve relevant domain memories
- [x] Retrieve current task/session context
- [x] Format compact memory block
- [x] Inject in `before_agent_start`
- [x] Add “memory may be stale, verify with tools” instruction

## Phase 12 — Edge usage
- [x] Create `session -> in_project -> project`
- [x] Create `session -> for_task -> task`
- [x] Create `pr -> relates_to -> task`
- [x] Create `pr -> created_from -> session` when known
- [x] Keep relation types minimal in v1

## Phase 13 — Safety / noise control
- [x] Do not store raw command output wholesale
- [x] Do not store large file contents
- [x] Do not store secrets/token-like strings
- [x] Prefer candidates over auto-promoting weak inferences
- [x] Keep retrieval small

## Phase 14 — Nice v1 polish
- [x] Status line/widget for current task
- [x] Better `/memory` display
- [ ] Better deduplication/merge for similar memories
- [ ] Mark stale memories later if needed

## Suggested next steps
1. Better dedupe/merging for scan and command memories
2. Staleness rules for old memories
3. Richer task detection and enrichment
4. Basic tests for extension commands and retrieval
5. Optional gitleaks integration if desired later

## Definition of done for first usable version
- [x] Starting Pi in a repo registers project + Pi session
- [x] `/task PROJ-123` links the session to a task
- [x] `/pr 482` links the current task to a PR
- [x] `/remember ...` stores stable memory
- [x] `/memory` shows useful remembered context
- [x] Future turns receive compact relevant memory automatically
