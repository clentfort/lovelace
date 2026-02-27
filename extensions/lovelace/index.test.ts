import { describe, it, expect } from 'vitest';
import LovelaceExtension from './index';

describe('LovelaceExtension', () => {
  it('should have the correct name and description', () => {
    const extension = new LovelaceExtension();
    expect(extension.name).toBe('lovelace');
    expect(extension.description).toBe('Always-On Engineering Lovelace');
  });

  it('should register the lovelace command', () => {
    const extension = new LovelaceExtension();
    const commands = extension.registerCommands();
    const workAgentCommand = commands.find(c => c.name === 'lovelace');

    expect(workAgentCommand).toBeDefined();
    expect(workAgentCommand?.description).toBe('Lovelace status and management');
  });

  it('should return the correct status from the command handler', async () => {
    const extension = new LovelaceExtension();
    const commands = extension.registerCommands();
    const workAgentCommand = commands.find(c => c.name === 'lovelace');

    const context: any = {};
    const result = await workAgentCommand?.handler(['status'], context);

    expect(result).toContain('Lovelace is active');
    expect(result).toContain('Memory: Online');
  });

  it('should return results from /search command', async () => {
    const extension = new LovelaceExtension();
    const commands = extension.registerCommands();
    const searchCommand = commands.find(c => c.name === 'search');

    const context: any = {};
    const result = await searchCommand?.handler(['incident', 'report'], context);

    expect(result).toContain('[github]');
    expect(result).toContain('[jira]');
    expect(result).toContain('[slack]');
    expect(result).toContain('incident report');
  });

  it('should block mutating tools in tool_call', async () => {
    const extension = new LovelaceExtension();
    const context: any = {};

    const mutatingTools = ['write_file', 'delete_file', 'rename_file', 'run_in_bash_session'];

    for (const tool of mutatingTools) {
      const call: any = { tool };
      await expect(extension.tool_call(call, context)).rejects.toThrow(/blocked by Lovelace policy/);
    }
  });

  it('should allow non-mutating tools in tool_call', async () => {
    const extension = new LovelaceExtension();
    const context: any = {};

    const safeTools = ['read_file', 'list_files', 'google_search'];

    for (const tool of safeTools) {
      const call: any = { tool };
      await expect(extension.tool_call(call, context)).resolves.not.toThrow();
    }
  });
});
