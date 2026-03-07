# Memory Extension v1

## Project

Lovelace is a personal workflow project. The first deliverable is a Pi extension that gives Pi a memory layer.

Target audience: **one user only**.

## Goal

Help Pi start work with useful remembered context across sessions and repos, without trying to mirror Jira, GitHub, git history, CI, or Sonar.

The extension should remember:

- my preferences
- repo-specific conventions and useful facts
- cross-repo tribal knowledge
- task/session context such as Jira issue ↔ Pi session ↔ PR linkage

## Non-goals for v1

Out of scope:

- multi-user support
- background syncing/polling of Jira, Slack, mail, GitHub, Sonar
- commit tracking as a first-class feature
- CI/check tracking
- full PR/ticket mirrors
- a real graph database
- a dashboard UI

## Core model: 4 scopes

### 1. User

Facts about me across all work.

Examples:

- prefer small diffs
- ask before broad refactors
- keep answers concise unless debugging

### 2. Project

Facts true for one repo.

Examples:

- uses pnpm
- generated files live in `src/generated`
- auth work usually touches `middleware/` and `routes/auth.ts`

### 3. Domain / Family

Shared tribal knowledge across multiple related repos.

Examples:

- `_infrastructure` is usually where IaC goes
- search services often sit behind varnish
- repos in this area often come in frontend/backend pairs

### 4. Task / Session

Ephemeral work context.

Examples:

- this Pi session is for `PROJ-123`
- currently refactoring auth
- PR `#482` belongs to this task
- backlink comment still needs to be added

Rule of thumb:

- user/project/domain = more stable memory
- task/session = temporary work graph / ephemeral notes

## Architecture

Use **SQLite** as local storage.

Important: model the data as a **graph conceptually**, but store it in normal SQLite tables.

Why:

- simple local setup
- easy querying/debugging
- easy migrations
- flexible enough for nodes + edges

## Pi session handling

A Pi session is a first-class entity in Lovelace, but Lovelace does **not** copy the whole Pi session.

Instead it stores a reference to the real Pi session on disk.

Session records should include:

- Pi session file path
- Pi session id if available
- project id
- optional linked task id/ref
- timestamps

This allows:

- reopening the exact session later
- linking task ↔ session ↔ PR
- mining old sessions later if needed

## What the extension stores

### Stable memory

Long-lived reusable knowledge:

- user preferences
- project conventions
- project structure facts
- useful repeated commands
- domain/family tribal knowledge

### Work graph / ephemeral memory

Task-oriented linkage and temporary notes:

- task refs like `PROJ-123`
- task summary/title if known
- session ↔ task link
- task ↔ PR link
- temporary notes like “currently refactoring X”
- backlink status if useful

## External systems policy

Do not duplicate systems of record more than needed.

Use as source of truth:

- git for commits/history
- GitHub for PR details/checks
- Jira/Slack/mail for original task discussions

Lovelace stores only the glue and distilled memory that helps future Pi sessions.

## v1 data model

This is intentionally small.

### projects

Represents a repo.

Suggested fields:

- `id`
- `name`
- `root_path`
- `git_remote`
- `first_seen_at`
- `last_seen_at`

### memories

Stable memory items.

Suggested fields:

- `id`
- `scope` = `user | project | domain | task`
- `project_id` nullable
- `task_id` nullable
- `kind` = `preference | structure | workflow | constraint | command | gotcha | note`
- `text`
- `confidence`
- `status` = `candidate | active | archived`
- `source` = `manual | heuristic | scan | llm`
- `created_at`
- `updated_at`
- `last_used_at` nullable

Notes:

- task-scoped memories are allowed for ephemeral notes
- domain scope is for tribal/shared cross-project knowledge

### tasks

Represents a work item, usually keyed by Jira issue or manual ref.

Suggested fields:

- `id`
- `ref` (example: `PROJ-123`)
- `source_type` = `jira | slack | mail | manual`
- `title` nullable
- `summary` nullable
- `status` = `active | paused | done | unknown`
- `created_at`
- `updated_at`
- `last_seen_at`

### pi_sessions

References actual Pi sessions on disk.

Suggested fields:

- `id`
- `pi_session_id` nullable
- `session_file`
- `project_id`
- `task_id` nullable
- `started_at`
- `updated_at`

### prs

Lightweight PR references only.

Suggested fields:

- `id`
- `project_id`
- `pr_number` nullable
- `pr_url` nullable
- `title` nullable
- `created_at`
- `updated_at`

### edges

Generic relationship table.

Suggested fields:

- `id`
- `from_type`
- `from_id`
- `edge_type`
- `to_type`
- `to_id`
- `metadata_json` nullable
- `created_at`

Use this for links like:

- task `works_on` project
- session `for_task` task
- session `in_project` project
- pr `relates_to` task
- pr `created_from` session
- project `relates_to` project

Note: we do **not** need a large ontology in v1. A generic relation mechanism is enough.

## Minimal relation philosophy

For v1, keep relation types small and pragmatic.

Examples:

- `relates_to`
- `for_task`
- `in_project`
- `created_from`
- `opened_for`
- `depends_on`

If a relation needs more semantics later, add it later.

Cross-project tribal knowledge like “`_infrastructure` is where IaC goes” is usually better stored as a **domain memory**, not as a project↔project edge.

## How memory gets created

### Manual

High-value and reliable.

Examples:

- `/remember user prefer small diffs`
- `/remember project generated files are in src/generated`
- `/remember domain _infrastructure usually contains IaC`
- `/task PROJ-123 billing retry bug`
- `/pr 482`

### Heuristic

From prompts, session info, and tool usage.

Good candidates:

- detecting task refs like `PROJ-123`
- repeated successful test/lint/build commands
- repo facts from manifests
- PR number/URL from `gh` output

### Scan

From reading repo files.

Examples:

- package manager
- workspace layout
- common directories
- generated-code boundaries

### LLM-assisted

Optional in v1, low priority.
Use only to distill candidate memories, not to store raw history.

## Extraction heuristics for v1

### Task detection

Detect task refs from:

- `/task ...`
- prompt text
- branch name
- `jira issue view PROJ-123`
- similar CLI output

Regex candidate:

- `[A-Z][A-Z0-9]+-\d+`

### PR detection

Detect PR references from:

- `/pr ...`
- `gh pr create`
- `gh pr view`
- `gh pr comment`
- PR URLs in tool output

### Stable project memory detection

Promote only high-value things such as:

- repeated successful commands
- explicit user statements
- repo layout facts from manifests/scans
- repeated warnings like “don’t edit generated files”

Do **not** store raw command history or large file contents as memory.

## Retrieval behavior

Before Pi starts a turn, retrieve a small amount of relevant memory.

Expected retrieval mix:

- a few user memories
- a few project memories
- a few domain memories
- current task/session context

Keep it compact.

The prompt should treat memory as helpful but potentially stale and encourage verification with tools.

## Initial slash commands

### `/memory`

Show relevant remembered context for current repo/task.

### `/remember <scope> <text>`

Manual memory entry.

Examples:

- `/remember user prefer small diffs`
- `/remember project generated files live in src/generated`
- `/remember domain _infrastructure usually contains IaC`

### `/forget <id>`

Archive or remove memory.

### `/task <ref> [summary]`

Set current task for the session.

Examples:

- `/task PROJ-123`
- `/task PROJ-123 billing retry bug`

### `/task clear`

Clear current task from the active session.

### `/task show`

Show current task, linked session info, linked PR if known.

### `/pr <number|url>`

Link a PR to the current task/session.

### `/memory scan`

Scan the current repo for structural facts.

## Pi extension behavior in v1

### On session start

- detect current repo/project
- register current Pi session in SQLite
- restore session-linked task if known
- load relevant memory caches

### Before agent start

- retrieve relevant user/project/domain/task memory
- inject compact memory context for the turn

### On tool use

Observe:

- `jira` CLI usage for task enrichment
- `gh` CLI usage for PR enrichment
- repeated successful commands for project memory

### On session/task changes

- persist task ↔ session links
- persist task ↔ PR links when detected or manually set

## Out-of-scope implementation choices for v1

Do not build yet:

- dashboard UI
- background daemons
- Jira or GitHub polling
- CI/Sonar ingestion
- commit graphing
- automated backlink synchronization

## Expected first milestone

A working Pi extension that can:

- remember user/project/domain facts
- link a Pi session to a task
- link a task to a PR
- reference the real Pi session file on disk
- inject useful remembered context into future sessions
