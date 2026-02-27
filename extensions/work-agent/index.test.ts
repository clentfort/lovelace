import { describe, it, expect } from 'vitest';
import WorkAgentExtension from './index';

describe('WorkAgentExtension', () => {
  it('should have the correct name and description', () => {
    const extension = new WorkAgentExtension();
    expect(extension.name).toBe('work-agent');
    expect(extension.description).toBe('Always-On Engineering Work Agent');
  });

  it('should register the work-agent command', () => {
    const extension = new WorkAgentExtension();
    const commands = extension.registerCommands();
    const workAgentCommand = commands.find(c => c.name === 'work-agent');

    expect(workAgentCommand).toBeDefined();
    expect(workAgentCommand?.description).toBe('Work Agent status and management');
  });

  it('should return the correct status from the command handler', async () => {
    const extension = new WorkAgentExtension();
    const commands = extension.registerCommands();
    const workAgentCommand = commands.find(c => c.name === 'work-agent');

    const context: any = {};
    const result = await workAgentCommand?.handler(['status'], context);

    expect(result).toContain('Work Agent is active');
    expect(result).toContain('Memory: Online');
  });

  it('should block mutating tools in tool_call', async () => {
    const extension = new WorkAgentExtension();
    const context: any = {};

    const mutatingTools = ['write_file', 'delete_file', 'rename_file', 'run_in_bash_session'];

    for (const tool of mutatingTools) {
      const call: any = { tool };
      await expect(extension.tool_call(call, context)).rejects.toThrow(/blocked by Work Agent policy/);
    }
  });

  it('should allow non-mutating tools in tool_call', async () => {
    const extension = new WorkAgentExtension();
    const context: any = {};

    const safeTools = ['read_file', 'list_files', 'google_search'];

    for (const tool of safeTools) {
      const call: any = { tool };
      await expect(extension.tool_call(call, context)).resolves.not.toThrow();
    }
  });
});
