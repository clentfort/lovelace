# Product Spec: Always-On Engineering Work Agent

## 1) Problem statement

Daily engineering work spans many disconnected systems (Slack, Jira, GitHub, calendar, email, multiple infra tools, 30+ repos). The current workflow requires manual context switching and repetitive retrieval steps.

Need: a personal, terminal-first assistant that continuously helps triage work, propose next actions, execute approved tasks, and retain context across repos and time.

## 2) Vision

A **human-in-the-loop work copilot** that:
- continuously ingests relevant signals,
- proposes useful actions,
- executes approved operations via tool adapters,
- learns personal preferences/work patterns over time,
- stays transparent, auditable, and reversible.

## 3) Goals

1. **Cross-repo memory**
   - remember conventions, active workstreams, and recurring patterns across many repos.

2. **Fast federated search**
   - unified search over Jira + Slack + GitHub (phase 1 priority).

3. **Action proposal engine**
   - convert incoming signals into prioritized, explainable suggestions.

4. **Human-in-the-loop safety**
   - all mutating actions require confirmation unless policy explicitly allows auto-run.

5. **CLI-first experience**
   - tmux-friendly workflows; optional web/mobile surface later.

## 4) Non-goals (initial phases)

- Fully autonomous execution across all systems.
- Building a complete enterprise workflow engine from day one.
- Solving every integration (Teams, Confluence, Spacelift, ArgoCD, AWS) in v1.

## 5) Users and context

Primary user: one senior software engineer managing high context load across many repositories/tools.

## 6) Core use cases

1. "What should I do next?" (morning triage)
2. "Summarize everything relevant for ticket X / PR Y / incident Z"
3. "Find all related Slack threads, Jira issues, PRs across repos"
4. "Draft a response/update/comment and ask me to approve"
5. "Track recurring preferences and avoid repeating setup instructions"

## 7) Functional requirements

### FR-1 Signal ingestion
- Collect signals from Slack, Jira, GitHub (phase 1).
- Normalize into a common `WorkSignal` structure.

### FR-2 Federated search
- Support query once, search many:
  - Jira issues/comments
  - Slack messages/threads
  - GitHub PRs/issues/comments/mentions
- Return ranked, grouped results with source links.

### FR-3 Memory
- Persist event log of key facts, decisions, preferences, and work items.
- Support retrieval by semantic similarity + keyword filtering.
- Track provenance and freshness.

### FR-4 Proposal generation
- Produce proposals with:
  - title,
  - rationale,
  - evidence links,
  - estimated effort/impact,
  - recommended next action.

### FR-5 Approval workflow
- For mutating actions (commenting, ticket transitions, posting messages, merges):
  - generate plan,
  - request explicit approval,
  - execute,
  - verify,
  - log outcome.

### FR-6 Tool adapter layer
- Wrap existing tools first:
  - `gh` CLI
  - `jira` CLI
  - `slackline`
  - then `sonar-sweep`, `lido-cli`, others.

### FR-7 Cross-repo context
- Build per-repo profiles and reusable patterns.
- Detect repo similarity and suggest known-good workflows.

## 8) Non-functional requirements

1. **Auditability**: every action traceable to signal + prompt + approval + result.
2. **Resilience**: restart-safe, append-only event history.
3. **Security**: least privilege where possible; explicit policy controls.
4. **Performance**: sub-3s target for common federated search queries (cached paths).
5. **Portability**: local-first state with straightforward backup/sync.

## 9) Success metrics

### Leading indicators (first 4–6 weeks)
- >= 60% of daily “context gathering” done via agent commands.
- >= 50% reduction in manual copy/paste across Jira/Slack/GitHub.
- >= 80% proposal acceptance for top 3 recurring workflows.

### Lagging indicators (quarter)
- measurable reduction in missed follow-ups/review requests.
- reduced average time from signal to decision/action.

## 10) Constraints and assumptions

- CLI-first interaction is acceptable and preferred.
- Existing CLIs are available and stable enough for adapters.
- Some integrations may require browser automation fallback.

## 11) Principles

1. Start narrow, ship quickly, iterate from real usage.
2. Prefer transparent deterministic flows over “clever” hidden behavior.
3. Keep human approval central for risky operations.
4. Favor composable extensions/skills over monolithic architecture.
