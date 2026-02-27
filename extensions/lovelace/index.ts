import { AgentContext, Command, Extension, Tool, ToolCall } from '@mariozechner/pi-agent';
import { GitHubAdapter } from './adapters/github';
import { JiraAdapter } from './adapters/jira';
import { SlackAdapter } from './adapters/slack';
import { Adapter, SearchResult } from './adapters/types';

export default class LovelaceExtension implements Extension {
  name = 'lovelace';
  description = 'Always-On Engineering Lovelace';

  async onAgentStart(context: AgentContext): Promise<void> {
    console.log('Lovelace Extension started.');
    // In a real environment, we'd ensure directories exist here if not already handled by a setup script.
    // For this POC, we rely on the environment being pre-configured as per doc/architecture.
  }

  private adapters: Adapter[] = [
    new GitHubAdapter(),
    new JiraAdapter(),
    new SlackAdapter()
  ];

  registerCommands(): Command[] {
    return [
      {
        name: 'lovelace',
        description: 'Lovelace status and management',
        handler: async (args: string[], context: AgentContext) => {
          if (args[0] === 'status') {
            return 'Lovelace is active. \n- Memory: Online\n- Adapters: GitHub, Jira, Slack\n- Policy: Read-only (default)';
          }
          return 'Usage: /lovelace status';
        },
      },
      {
        name: 'search',
        description: 'Unified search across GitHub, Jira, and Slack',
        handler: async (args: string[], context: AgentContext) => {
          const query = args.join(' ');
          if (!query) return 'Usage: /search <query>';

          const results: SearchResult[] = [];
          for (const adapter of this.adapters) {
            const adapterResults = await adapter.search({ query });
            results.push(...adapterResults);
          }

          if (results.length === 0) return `No results found for "${query}"`;

          return results.map(r => `[${r.source}] ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n\n');
        },
      },
    ];
  }

  async tool_call(call: ToolCall, context: AgentContext): Promise<void> {
    const mutatingTools = ['write_file', 'delete_file', 'rename_file', 'run_in_bash_session'];
    // In a real implementation, we would check the command being run in bash for mutations.
    // For this POC, we block common mutating tools if not explicitly approved.

    if (mutatingTools.includes(call.tool)) {
        // Simplified check: if it's run_in_bash_session, we'd need more logic to see if it's a mutation.
        // For now, let's just log and block for demonstration.
        console.warn(`Blocking potentially mutating tool call: ${call.tool}`);
        throw new Error(`Action '${call.tool}' blocked by Lovelace policy. Mutation requires explicit approval.`);
    }
  }
}
