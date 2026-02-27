import { describe, it, expect } from 'vitest';
import { GitHubAdapter } from './github';

describe('GitHubAdapter', () => {
  it('should return mock search results', async () => {
    const adapter = new GitHubAdapter();
    const results = await adapter.search({ query: 'test' });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe('github');
    expect(results[0].title).toContain('test');
  });
});
