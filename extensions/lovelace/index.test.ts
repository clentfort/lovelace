import { describe, it, expect } from 'vitest';
import lovelaceExtension, {
  formatStatus,
  isMutatingToolCall,
} from './index';

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

describe('Lovelace extension (Pi API)', () => {
  it('registers expected commands and event handlers', () => {
    const pi = createPiMock();
    lovelaceExtension(pi);

    expect(pi.commands.has('lovelace')).toBe(true);
    expect(pi.commands.has('search')).toBe(true);
    expect(pi.events.has('tool_call')).toBe(true);
    expect(pi.events.has('session_start')).toBe(true);
    expect(pi.events.has('session_shutdown')).toBe(true);
  });

  it('returns formatted lovelace status', async () => {
    const pi = createPiMock();
    lovelaceExtension(pi);

    const result = await pi.commands.get('lovelace').handler('status');
    expect(result).toBe(formatStatus());
    expect(result).toContain('Lovelace is active.');
  });

  it('returns aggregated results from /search', async () => {
    const pi = createPiMock();
    lovelaceExtension(pi);

    const result = await pi.commands.get('search').handler('incident report');
    expect(result).toContain('[github]');
    expect(result).toContain('[jira]');
    expect(result).toContain('[slack]');
    expect(result).toContain('incident report');
  });

  it('blocks mutating tool calls via tool_call event', async () => {
    const pi = createPiMock();
    lovelaceExtension(pi);

    const onToolCall = pi.events.get('tool_call');

    await expect(onToolCall({ toolName: 'write', input: { path: 'a.txt' } })).resolves.toEqual(
      expect.objectContaining({ block: true }),
    );

    await expect(
      onToolCall({ toolName: 'bash', input: { command: 'rm -rf /tmp/test' } }),
    ).resolves.toEqual(expect.objectContaining({ block: true }));

    await expect(
      onToolCall({ toolName: 'bash', input: { command: 'ls -la' } }),
    ).resolves.toBeUndefined();
  });

  it('classifies mutating tools and commands', () => {
    expect(isMutatingToolCall('write')).toBe(true);
    expect(isMutatingToolCall('edit')).toBe(true);
    expect(isMutatingToolCall('run_in_bash_session')).toBe(true);
    expect(isMutatingToolCall('bash', { command: 'git commit -m "x"' })).toBe(true);
    expect(isMutatingToolCall('bash', { command: 'git status' })).toBe(false);
    expect(isMutatingToolCall('read')).toBe(false);
  });
});
