export interface SearchResult {
  id: string;
  source: 'github' | 'jira' | 'slack';
  title: string;
  snippet: string;
  url: string;
  repo?: string;
  timestamp: string;
  author?: string;
  scoreHints?: {
    exact?: boolean;
    recency?: number;
  };
}

export interface SearchOptions {
  query: string;
  repo?: string;
  since?: string;
  limit?: number;
}

export interface Adapter {
  name: string;
  search(options: SearchOptions): Promise<SearchResult[]>;
}
