# MVP Spec: Cross-Repo Memory + Jira/Slack/GitHub Search

This is the **most crucial immediate milestone**.

## 1) Scope

### In scope
1. Unified search across:
   - GitHub (via `gh`)
   - Jira (via `jira`)
   - Slack (via `slackline`)
2. Durable cross-repo memory store.
3. Repo profile extraction and reuse.
4. CLI commands for daily use.

### Out of scope (for MVP)
- Automated write actions (comments/transitions/posts).
- Email/calendar ingestion.
- Full autonomy/heartbeat.

## 2) User-facing commands (proposed)

### `/search <query>`
Options:
- `--sources github,jira,slack` (default all)
- `--repo <name>`
- `--since <duration>` (e.g., `7d`)
- `--limit <n>`

Output:
- grouped by source,
- ranked by relevance,
- each result includes permalink and short rationale.

### `/memory add <text>`
Store an explicit memory note with optional tags/scope.

### `/memory find <query>`
Search memory entries (and optionally linked source results).

### `/repo profile [--repo <name>]`
Extract and/or show repo profile:
- stack,
- build/test/lint commands,
- deployment hints,
- conventions observed.

## 3) Adapter contract

Each adapter should return normalized records:

```json
{
  "id": "source-specific-id",
  "source": "github|jira|slack",
  "title": "...",
  "snippet": "...",
  "url": "https://...",
  "repo": "optional",
  "timestamp": "ISO-8601",
  "author": "optional",
  "scoreHints": { "exact": true, "recency": 0.82 }
}
```

## 4) Ranking approach (MVP)

Weighted score:
- lexical match: 50%
- recency: 20%
- repo affinity: 20%
- source importance rules: 10%

Example source rule:
- direct mention/review request > generic chatter

## 5) Memory model (MVP)

### Persisted event types
- `search_query`
- `search_result_opened`
- `memory_added`
- `repo_profile_updated`
- `preference_observed`

### Initial table set (SQLite)
- `memory_entries`
- `repo_profiles`
- `source_artifacts`
- `event_log`

## 6) Implementation sequence

1. Build adapter wrappers with deterministic parsing.
2. Add `/search` command and normalized output.
3. Add event log and SQLite persistence.
4. Add `/memory find` and `/repo profile`.
5. Add ranking tuning from usage telemetry.

## 7) Acceptance tests

1. Query `"PROJ-123 auth timeout"` returns at least one result from each available source when data exists.
2. Results include valid links and source labels.
3. Memory note added in one repo is retrievable from another repo session.
4. Repo profile generated for repo A does not overwrite repo B profile.
5. Agent restart does not lose memory/search history.

## 8) Day-1 usage examples

- `/search incident oauth callback --since 3d`
- `/search PROJ-123 --sources jira,github`
- `/memory add Team prefers squash-merge on service repos #workflow #git`
- `/memory find squash merge service repos`
- `/repo profile --repo payments-api`

## 9) Risks and mitigations

1. **Slack selector drift (UI automation):** add adapter health check + fallback guidance.
2. **CLI auth drift:** expose `/auth doctor` command to validate tokens/sessions.
3. **Ranking noise:** capture feedback signals (`useful/not-useful`) for tuning.
