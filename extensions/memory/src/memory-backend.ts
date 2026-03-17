import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { createStore, type QMDStore } from "@tobilu/qmd";
import type {
  ArchiveMemoryResult,
  CreateMemoryInput,
  LovelaceStore,
  MemoryMaintenanceResult,
  MemoryProposalOutcome,
  MemoryStats,
  ProposeMemoryInput,
  ResolveByPrefixResult,
} from "./db.js";
import type { MemoryProposalRecord, MemoryRecord, MemoryProposalStatus } from "./types.js";

export interface MemoryBackend {
  createMemory(input: CreateMemoryInput): Promise<MemoryRecord>;
  proposeMemory(input: ProposeMemoryInput): Promise<MemoryProposalOutcome>;
  getRelevantMemories(
    projectId?: string | null,
    taskId?: string | null,
    options?: { queryText?: string; limit?: number },
  ): Promise<MemoryRecord[]>;
  getMemoryStats(
    projectId?: string | null,
    taskId?: string | null,
    options?: { contextOnly?: boolean },
  ): Promise<MemoryStats>;
  archiveMemory(idOrPrefix: string): Promise<ArchiveMemoryResult>;
  listMemoryProposals(
    projectId?: string | null,
    taskId?: string | null,
    options?: {
      queryText?: string;
      limit?: number;
      statuses?: MemoryProposalStatus[];
      contextOnly?: boolean;
    },
  ): Promise<MemoryProposalRecord[]>;
  promoteMemoryProposal(
    idOrPrefix: string,
  ): Promise<
    { ok: true; proposal: MemoryProposalRecord; memory?: MemoryRecord } | ResolveByPrefixResult
  >;
  rejectMemoryProposal(
    idOrPrefix: string,
  ): Promise<{ ok: true; proposal: MemoryProposalRecord } | ResolveByPrefixResult>;
  runMaintenance(now?: number): Promise<MemoryMaintenanceResult>;
  markMemoriesUsed(ids: string[]): Promise<void>;
  close(): Promise<void>;
}

export class SqliteMemoryBackend implements MemoryBackend {
  constructor(private readonly store: LovelaceStore) {}

  async createMemory(input: CreateMemoryInput): Promise<MemoryRecord> {
    return this.store.createMemory(input);
  }

  async proposeMemory(input: ProposeMemoryInput): Promise<MemoryProposalOutcome> {
    return this.store.proposeMemory(input);
  }

  async getRelevantMemories(
    projectId?: string | null,
    taskId?: string | null,
    options?: { queryText?: string; limit?: number },
  ): Promise<MemoryRecord[]> {
    return this.store.getRelevantMemories(projectId, taskId, options);
  }

  async getMemoryStats(
    projectId?: string | null,
    taskId?: string | null,
    options?: { contextOnly?: boolean },
  ): Promise<MemoryStats> {
    return this.store.getMemoryStats(projectId, taskId, options);
  }

  async archiveMemory(idOrPrefix: string): Promise<ArchiveMemoryResult> {
    return this.store.archiveMemory(idOrPrefix);
  }

  async listMemoryProposals(
    projectId?: string | null,
    taskId?: string | null,
    options?: {
      queryText?: string;
      limit?: number;
      statuses?: MemoryProposalStatus[];
      contextOnly?: boolean;
    },
  ): Promise<MemoryProposalRecord[]> {
    return this.store.listMemoryProposals(projectId, taskId, options);
  }

  async promoteMemoryProposal(
    idOrPrefix: string,
  ): Promise<
    { ok: true; proposal: MemoryProposalRecord; memory?: MemoryRecord } | ResolveByPrefixResult
  > {
    return this.store.promoteMemoryProposal(idOrPrefix);
  }

  async rejectMemoryProposal(
    idOrPrefix: string,
  ): Promise<{ ok: true; proposal: MemoryProposalRecord } | ResolveByPrefixResult> {
    return this.store.rejectMemoryProposal(idOrPrefix);
  }

  async runMaintenance(now?: number): Promise<MemoryMaintenanceResult> {
    return this.store.runMemoryMaintenance(now);
  }

  async markMemoriesUsed(ids: string[]): Promise<void> {
    this.store.markMemoriesUsed(ids);
  }

  async close(): Promise<void> {
    // nothing to close for sqlite adapter
  }
}

class QmdMemoryBackend implements MemoryBackend {
  private readonly delegate: SqliteMemoryBackend;
  private readonly docsRoot: string;
  private readonly qmdDbPath: string;
  private qmdStorePromise: Promise<QMDStore>;

  constructor(private readonly store: LovelaceStore) {
    this.delegate = new SqliteMemoryBackend(store);
    this.docsRoot = join(homedir(), ".lovelace", "qmd-memory-docs");
    this.qmdDbPath = join(homedir(), ".lovelace", "qmd-memory-index.sqlite");
    mkdirSync(join(this.docsRoot, "memories"), { recursive: true });
    mkdirSync(join(this.docsRoot, "proposals"), { recursive: true });
    this.qmdStorePromise = this.createQmdStore();
  }

  private async createQmdStore(): Promise<QMDStore> {
    const qmdStore = await createStore({
      dbPath: this.qmdDbPath,
      config: {
        collections: {
          memories: {
            path: this.docsRoot,
            pattern: "**/*.md",
            includeByDefault: true,
          },
        },
      },
    });
    await qmdStore.update({ collections: ["memories"] });
    return qmdStore;
  }

  async close(): Promise<void> {
    const qmdStore = await this.qmdStorePromise;
    await qmdStore.close();
  }

  private memoryDocPath(memoryId: string): string {
    return join(this.docsRoot, "memories", `${memoryId}.md`);
  }

  private proposalDocPath(proposalId: string): string {
    return join(this.docsRoot, "proposals", `${proposalId}.md`);
  }

  private writeMemoryDoc(memory: MemoryRecord): void {
    const content = [
      "---",
      `type: memory`,
      `id: ${memory.id}`,
      `scope: ${memory.scope}`,
      `kind: ${memory.kind}`,
      `status: ${memory.status}`,
      `source: ${memory.source}`,
      `confidence: ${memory.confidence.toFixed(3)}`,
      `projectId: ${memory.projectId ?? ""}`,
      `taskId: ${memory.taskId ?? ""}`,
      `updatedAt: ${memory.updatedAt}`,
      "---",
      "",
      memory.text,
      "",
    ].join("\n");
    writeFileSync(this.memoryDocPath(memory.id), content, "utf8");
  }

  private writeProposalDoc(proposal: MemoryProposalRecord): void {
    const content = [
      "---",
      `type: proposal`,
      `id: ${proposal.id}`,
      `scope: ${proposal.scope}`,
      `kind: ${proposal.kind}`,
      `status: ${proposal.status}`,
      `source: ${proposal.source}`,
      `confidenceMax: ${proposal.confidenceMax.toFixed(3)}`,
      `supportCount: ${proposal.supportCount}`,
      `distinctSessionCount: ${proposal.distinctSessionCount}`,
      `distinctTaskCount: ${proposal.distinctTaskCount}`,
      `projectId: ${proposal.projectId ?? ""}`,
      `taskId: ${proposal.taskId ?? ""}`,
      `updatedAt: ${proposal.updatedAt}`,
      "---",
      "",
      proposal.text,
      "",
    ].join("\n");
    writeFileSync(this.proposalDocPath(proposal.id), content, "utf8");
  }

  private removeProposalDoc(proposalId: string): void {
    rmSync(this.proposalDocPath(proposalId), { force: true });
  }

  private async refreshQmdIndex(): Promise<void> {
    const qmdStore = await this.qmdStorePromise;
    await qmdStore.update({ collections: ["memories"] });
  }

  private belongsToContext(
    memory: MemoryRecord,
    projectId?: string | null,
    taskId?: string | null,
  ): boolean {
    if (memory.status !== "active") return false;
    if (memory.scope === "user" || memory.scope === "domain") return true;
    if (memory.scope === "project") return memory.projectId === (projectId ?? null);
    if (memory.scope === "task") return memory.taskId === (taskId ?? null);
    return false;
  }

  private parseMemoryIdFromPath(filepath: string): string | undefined {
    const normalized = filepath.replace(/\\/g, "/");
    if (!normalized.includes("/memories/")) return undefined;
    const file = basename(normalized);
    if (!file.endsWith(".md")) return undefined;
    return file.slice(0, -3);
  }

  async createMemory(input: CreateMemoryInput): Promise<MemoryRecord> {
    const memory = await this.delegate.createMemory(input);
    this.writeMemoryDoc(memory);
    await this.refreshQmdIndex();
    return memory;
  }

  async proposeMemory(input: ProposeMemoryInput): Promise<MemoryProposalOutcome> {
    const outcome = await this.delegate.proposeMemory(input);
    this.writeProposalDoc(outcome.proposal);
    if (outcome.promotedMemory) {
      this.writeMemoryDoc(outcome.promotedMemory);
      this.removeProposalDoc(outcome.proposal.id);
    }
    await this.refreshQmdIndex();
    return outcome;
  }

  async getRelevantMemories(
    projectId?: string | null,
    taskId?: string | null,
    options?: { queryText?: string; limit?: number },
  ): Promise<MemoryRecord[]> {
    const queryText = options?.queryText?.trim();
    const limit = Math.max(1, Math.min(40, options?.limit ?? 20));
    if (!queryText) {
      return this.delegate.getRelevantMemories(projectId, taskId, options);
    }

    try {
      const qmdStore = await this.qmdStorePromise;
      const results = await qmdStore.searchLex(queryText, { limit: 250, collection: "memories" });
      const selected: MemoryRecord[] = [];
      const seen = new Set<string>();
      for (const result of results) {
        const memoryId = this.parseMemoryIdFromPath(result.filepath);
        if (!memoryId || seen.has(memoryId)) continue;
        seen.add(memoryId);
        const memory = this.store.getMemoryById(memoryId);
        if (!memory) continue;
        if (!this.belongsToContext(memory, projectId, taskId)) continue;
        selected.push(memory);
        if (selected.length >= limit) break;
      }
      if (selected.length > 0) return selected;
    } catch {
      // fall back to sqlite retrieval below
    }

    return this.delegate.getRelevantMemories(projectId, taskId, options);
  }

  async getMemoryStats(
    projectId?: string | null,
    taskId?: string | null,
    options?: { contextOnly?: boolean },
  ): Promise<MemoryStats> {
    return this.delegate.getMemoryStats(projectId, taskId, options);
  }

  async archiveMemory(idOrPrefix: string): Promise<ArchiveMemoryResult> {
    const result = await this.delegate.archiveMemory(idOrPrefix);
    if (result.ok && result.id) {
      const memory = this.store.getMemoryById(result.id);
      if (memory) this.writeMemoryDoc(memory);
      await this.refreshQmdIndex();
    }
    return result;
  }

  async listMemoryProposals(
    projectId?: string | null,
    taskId?: string | null,
    options?: {
      queryText?: string;
      limit?: number;
      statuses?: MemoryProposalStatus[];
      contextOnly?: boolean;
    },
  ): Promise<MemoryProposalRecord[]> {
    return this.delegate.listMemoryProposals(projectId, taskId, options);
  }

  async promoteMemoryProposal(
    idOrPrefix: string,
  ): Promise<
    { ok: true; proposal: MemoryProposalRecord; memory?: MemoryRecord } | ResolveByPrefixResult
  > {
    const result = await this.delegate.promoteMemoryProposal(idOrPrefix);
    if (!result.ok) return result;

    this.writeProposalDoc(result.proposal);
    if (result.memory) this.writeMemoryDoc(result.memory);
    await this.refreshQmdIndex();
    return result;
  }

  async rejectMemoryProposal(
    idOrPrefix: string,
  ): Promise<{ ok: true; proposal: MemoryProposalRecord } | ResolveByPrefixResult> {
    const result = await this.delegate.rejectMemoryProposal(idOrPrefix);
    if (!result.ok) return result;

    this.writeProposalDoc(result.proposal);
    await this.refreshQmdIndex();
    return result;
  }

  async runMaintenance(now?: number): Promise<MemoryMaintenanceResult> {
    const result = await this.delegate.runMaintenance(now);
    await this.refreshQmdIndex();
    return result;
  }

  async markMemoriesUsed(ids: string[]): Promise<void> {
    await this.delegate.markMemoriesUsed(ids);
  }
}

export function createMemoryBackend(store: LovelaceStore): MemoryBackend {
  const requested = (process.env.LOVELACE_MEMORY_BACKEND ?? "sqlite").trim().toLowerCase();

  if (requested === "qmd") {
    return new QmdMemoryBackend(store);
  }

  return new SqliteMemoryBackend(store);
}
