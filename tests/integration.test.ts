import { describe, it, expect } from 'vitest';
import lovelaceExtension from '../extensions/lovelace/index';

function createPiMock() {
  const commands = new Map<string, any>();
  const events = new Map<string, any>();

  return {
    commands,
    events,
    registerCommand(name: string, definition: any) {
      commands.set(name, definition);
    },
    on(eventName: string, handler: any) {
      events.set(eventName, handler);
    },
  };
}

describe('Lovelace extension integration', () => {
  it('handles status and search command flow', async () => {
    const pi = createPiMock();
    lovelaceExtension(pi);

    const statusResult = await pi.commands.get('lovelace').handler('status');
    expect(statusResult).toContain('Lovelace is active.');

    const searchResult = await pi.commands.get('search').handler('auth timeout');
    expect(searchResult).toContain('[github]');
    expect(searchResult).toContain('[jira]');
    expect(searchResult).toContain('[slack]');
  });

  it('enforces read-only policy across tool-call sequence', async () => {
    const pi = createPiMock();
    lovelaceExtension(pi);

    const onToolCall = pi.events.get('tool_call');

    const sequence = [
      { event: { toolName: 'read', input: { path: 'docs/README.md' } }, blocked: false },
      { event: { toolName: 'write', input: { path: 'bad.txt', content: 'hack' } }, blocked: true },
      { event: { toolName: 'bash', input: { command: 'ls -la' } }, blocked: false },
      { event: { toolName: 'bash', input: { command: 'rm -rf /' } }, blocked: true },
    ];

    for (const step of sequence) {
      const result = await onToolCall(step.event);
      if (step.blocked) {
        expect(result).toEqual(expect.objectContaining({ block: true }));
      } else {
        expect(result).toBeUndefined();
      }
    }
  });
});
