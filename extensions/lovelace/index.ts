import { GitHubAdapter } from './adapters/github';
import { JiraAdapter } from './adapters/jira';
import { SlackAdapter } from './adapters/slack';
import { Adapter, SearchResult } from './adapters/types';

const DEFAULT_ADAPTERS: Adapter[] = [
  new GitHubAdapter(),
  new JiraAdapter(),
  new SlackAdapter(),
];

const ALWAYS_BLOCKED_TOOLS = new Set([
  'write',
  'edit',
  'write_file',
  'delete_file',
  'rename_file',
  'run_in_bash_session',
]);

const BASH_MUTATION_PATTERN = /\b(rm|mv|cp|chmod|chown|touch|mkdir|rmdir|truncate|git\s+(add|commit|push|merge|rebase|reset|stash)|npm\s+(install|uninstall|update)|pnpm\s+(add|remove|update)|yarn\s+(add|remove|upgrade)|docker\s+(rm|rmi|build|push)|kubectl\s+(apply|delete|patch)|terraform\s+(apply|destroy))\b/i;

export function formatStatus(): string {
  return [
    'Lovelace is active.',
    '- Memory: Online',
    '- Adapters: GitHub, Jira, Slack',
    '- Policy: Read-only (default)',
  ].join('\n');
}

export function formatSearchResults(results: SearchResult[]): string {
  return results
    .map((r) => `[${r.source}] ${r.title}\n   ${r.url}\n   ${r.snippet}`)
    .join('\n\n');
}

export async function searchAll(
  query: string,
  adapters: Adapter[] = DEFAULT_ADAPTERS,
): Promise<SearchResult[]> {
  const allResults = await Promise.all(adapters.map((adapter) => adapter.search({ query })));
  return allResults.flat();
}

export function isMutatingToolCall(toolName: string, input?: { command?: string }): boolean {
  const normalizedTool = toolName.toLowerCase();

  if (ALWAYS_BLOCKED_TOOLS.has(normalizedTool)) return true;

  if (normalizedTool === 'bash') {
    const command = (input?.command ?? '').trim();
    if (!command) return true;
    return BASH_MUTATION_PATTERN.test(command);
  }

  return false;
}

export default function lovelaceExtension(pi: any): void {
  const adapters = DEFAULT_ADAPTERS;

  pi.on('session_start', async (_event: unknown, ctx: any) => {
    if (ctx?.hasUI && ctx.ui?.setStatus) {
      ctx.ui.setStatus('lovelace', 'Lovelace active · read-only policy');
    }
  });

  pi.on('session_shutdown', async (_event: unknown, ctx: any) => {
    if (ctx?.hasUI && ctx.ui?.setStatus) {
      ctx.ui.setStatus('lovelace', undefined);
    }
  });

  pi.registerCommand('lovelace', {
    description: 'Lovelace status and management',
    handler: async (args?: string) => {
      const [subcommand] = (args ?? '').trim().split(/\s+/);
      if (subcommand === 'status') return formatStatus();
      return 'Usage: /lovelace status';
    },
  });

  pi.registerCommand('search', {
    description: 'Unified search across GitHub, Jira, and Slack',
    handler: async (args?: string) => {
      const query = (args ?? '').trim();
      if (!query) return 'Usage: /search <query>';

      const results = await searchAll(query, adapters);
      if (results.length === 0) return `No results found for "${query}"`;
      return formatSearchResults(results);
    },
  });

  pi.on('tool_call', async (event: any) => {
    const toolName: string | undefined = event?.toolName ?? event?.tool;
    const input = event?.input ?? event?.arguments;

    if (!toolName) return;
    if (!isMutatingToolCall(toolName, input)) return;

    return {
      block: true,
      reason: `Action '${toolName}' blocked by Lovelace policy. Mutation requires explicit approval.`,
    };
  });
}
