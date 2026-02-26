import { describe, it, expect, vi } from 'vitest';

// Mocking @mariozechner/pi-agent for integration test as well
vi.mock('@mariozechner/pi-agent', () => {
    return {
        // Any needed exports
    };
});

import WorkAgentExtension from '../extensions/work-agent/index';

// Simple mock context to simulate agent session
const mockContext: any = {
  session: {
    id: 'test-session',
  }
};

describe('Work Agent Integration', () => {
  it('should initialize and handle status command', async () => {
    const extension = new WorkAgentExtension();
    await extension.onAgentStart(mockContext);

    const commands = extension.registerCommands();
    const statusCmd = commands.find(c => c.name === 'work-agent');

    const result = await statusCmd?.handler(['status'], mockContext);
    expect(result).toContain('Work Agent is active');
  });

  it('should enforce read-only policy across different tool calls', async () => {
    const extension = new WorkAgentExtension();

    const sequence = [
      { tool: 'list_files', args: { path: '.' }, shouldPass: true },
      { tool: 'write_file', args: { filepath: 'bad.txt', content: 'hack' }, shouldPass: false },
      { tool: 'read_file', args: { filepath: 'docs/README.md' }, shouldPass: true },
      { tool: 'run_in_bash_session', args: { command: 'rm -rf /' }, shouldPass: false },
    ];

    for (const step of sequence) {
      const call: any = { tool: step.tool, arguments: step.args };
      if (step.shouldPass) {
        await expect(extension.tool_call(call, mockContext)).resolves.not.toThrow();
      } else {
        await expect(extension.tool_call(call, mockContext)).rejects.toThrow();
      }
    }
  });
});
