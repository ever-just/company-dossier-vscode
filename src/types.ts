// ---------------------------------------------------------------------------
// Shared types for the research pipeline.
//
// These interfaces describe the inputs and outputs that flow between the
// orchestrator (agent.ts), the entry points (sidebar/extension), and the
// generators. They live here — rather than in agent.ts — so generators can
// depend on the data contract without importing the orchestrator.
// ---------------------------------------------------------------------------

import { WebsiteData } from './collectors/website';
import { WaybackData } from './collectors/wayback';
import { DnsData } from './collectors/dns';
import { TechStackData } from './collectors/techstack';
import { SearchData } from './collectors/search';

/** User-provided research request. */
export interface ResearchInput {
  companyName: string;
  url: string;
  depth: 'quick' | 'standard' | 'deep';
  apiKey?: string;
}

/** Progress callback used to stream status messages back to the UI. */
export interface ResearchProgress {
  (message: string): void;
}

/** A single page fetched during the deep crawl. */
export interface CrawledPage {
  url: string;
  html: string;
  title: string;
  status: 'ok' | 'error';
}

/** The four sections produced by optional Claude synthesis. */
export interface LLMSynthesis {
  executiveBrief: string;
  swotAnalysis: string;
  keyFindings: string;
  manualResearchNeeded: string;
}

/** Everything a single research run collects and produces. */
export interface ResearchResult {
  companyName: string;
  dossierPath: string;
  filesCreated: number;
  websiteData?: WebsiteData;
  waybackData?: WaybackData;
  dnsData?: DnsData;
  techData?: TechStackData;
  searchData?: SearchData;
  crawledPages: CrawledPage[];
  llmSynthesis?: LLMSynthesis;
  errors: string[];
}
