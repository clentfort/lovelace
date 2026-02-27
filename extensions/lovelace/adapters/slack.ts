import { Adapter, SearchOptions, SearchResult } from './types';

export class SlackAdapter implements Adapter {
  name = 'slack';

  async search(options: SearchOptions): Promise<SearchResult[]> {
    // Simulating 'slackline search <query>'
    return [
      {
        id: 'slack-1',
        source: 'slack',
        title: `Slack message in #general`,
        snippet: `Someone mentioned ${options.query} on Slack.`,
        url: 'https://slack.com/archives/C123/P123',
        timestamp: new Date().toISOString(),
        author: 'colleague'
      }
    ];
  }
}
