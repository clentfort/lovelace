import { describe, it, expect } from 'vitest';
import LovelaceExtension from '../extensions/lovelace/index';

// Simple mock context to simulate agent session
const mockContext: any = {
  session: {
    id: 'test-session',
  }
};

describe('Lovelace Integration', () => {
  it('should initialize and handle status command', async () => {
    const extension = new LovelaceExtension();
    await extension.onAgentStart(mockContext);

    const commands = extension.registerCommands();
    const statusCmd = commands.find(c => c.name === 'lovelace');

    const result = await statusCmd?.handler(['status'], mockContext);
    expect(result).toContain('Lovelace is active');
  });

  it('should enforce read-only policy across different tool calls', async () => {
    const extension = new LovelaceExtension();

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
