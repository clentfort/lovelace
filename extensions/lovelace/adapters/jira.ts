import { Adapter, SearchOptions, SearchResult } from './types';

export class JiraAdapter implements Adapter {
  name = 'jira';

  async search(options: SearchOptions): Promise<SearchResult[]> {
    // Simulating 'jira issue list --query <query>'
    return [
      {
        id: 'jira-1',
        source: 'jira',
        title: `[PROJ-123] Mock Jira Ticket for ${options.query}`,
        snippet: `Jira ticket description snippet for ${options.query}`,
        url: 'https://jira.example.com/browse/PROJ-123',
        timestamp: new Date().toISOString(),
        author: 'jules'
      }
    ];
  }
}
