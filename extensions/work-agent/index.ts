import { AgentContext, Command, Extension, Tool, ToolCall } from '@mariozechner/pi-agent';

export default class WorkAgentExtension implements Extension {
  name = 'work-agent';
  description = 'Always-On Engineering Work Agent';

  async onAgentStart(context: AgentContext): Promise<void> {
    console.log('Work Agent Extension started.');
  }

  registerCommands(): Command[] {
    return [
      {
        name: 'work-agent',
        description: 'Work Agent status and management',
        handler: async (args: string[], context: AgentContext) => {
          if (args[0] === 'status') {
            return 'Work Agent is active. \n- Memory: Online\n- Adapters: GitHub, Jira, Slack\n- Policy: Read-only (default)';
          }
          return 'Usage: /work-agent status';
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
        throw new Error(`Action '${call.tool}' blocked by Work Agent policy. Mutation requires explicit approval.`);
    }
  }
}
