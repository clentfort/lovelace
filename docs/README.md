# Always-On Work Agent (Pi-based) — Planning Docs

This folder contains the initial research and spec for building a personal, always-on engineering assistant on top of **pi**.

## Documents

1. [01-research-frameworks-and-patterns.md](./01-research-frameworks-and-patterns.md)
   - Research findings on established agent systems/frameworks
   - Focus on memory, tool integration, and human-in-the-loop patterns
   - Includes findings from `rho` and `openclaw`

2. [02-product-spec.md](./02-product-spec.md)
   - Product requirements and scope
   - Goals/non-goals
   - Core use cases and success metrics

3. [03-architecture-and-design.md](./03-architecture-and-design.md)
   - Proposed architecture for a Pi extension + daemon approach
   - Memory model, tool adapter model, approval gates, security

4. [04-phased-roadmap.md](./04-phased-roadmap.md)
   - Incremental build plan (start small, expand over time)
   - Milestones, deliverables, and exit criteria

5. [05-mvp-cross-repo-memory-and-search.md](./05-mvp-cross-repo-memory-and-search.md)
   - Detailed MVP spec for the most crucial requirement right now:
     - Cross-repo memory
     - Effective search across Jira, Slack, and GitHub

## Guiding Principle

Build the **smallest useful loop first**:
1. ingest signals,
2. propose actions,
3. require approval,
4. execute safely,
5. learn from outcomes.
