import * as vscode from 'vscode';
import * as path from 'path';
import { collectWebsite, WebsiteData } from './collectors/website';
import { collectWayback, WaybackData } from './collectors/wayback';
import { collectDns, DnsData } from './collectors/dns';
import { extractTechStack, TechStackData } from './collectors/techstack';
import { scaffoldDossier } from './generators/scaffold';
import { generateCorporateFiles } from './generators/corporate';
import { generateRouter } from './generators/router';
import { todayISO } from './utils';

export interface ResearchInput {
  companyName: string;
  url: string;
  depth: 'quick' | 'standard' | 'deep';
}

export interface ResearchProgress {
  (message: string): void;
}

export interface ResearchResult {
  companyName: string;
  dossierPath: string;
  filesCreated: number;
  websiteData?: WebsiteData;
  waybackData?: WaybackData;
  dnsData?: DnsData;
  techData?: TechStackData;
  errors: string[];
}

export async function runResearch(
  input: ResearchInput,
  workspaceRoot: string,
  progress: ResearchProgress
): Promise<ResearchResult> {
  const dossierDir = path.join(workspaceRoot, `${input.companyName} DOSSIER`);
  const errors: string[] = [];
  let filesCreated = 0;

  // Phase 1: Scaffold
  progress('Creating dossier structure...');
  filesCreated += scaffoldDossier(dossierDir, input.companyName);

  // Phase 2: Website crawl
  progress(`Fetching ${input.url}...`);
  let websiteData: WebsiteData | undefined;
  try {
    websiteData = await collectWebsite(input.url);
    if (websiteData.error) { errors.push('Website: ' + websiteData.error); }
    else { progress(`Found: "${websiteData.title}" — ${websiteData.sitemapUrls.length} URLs in sitemap`); }
  } catch (e: any) { errors.push('Website fetch failed: ' + e.message); }

  // Phase 3: Wayback Machine
  let waybackData: WaybackData | undefined;
  if (input.depth !== 'quick') {
    progress('Querying Wayback Machine...');
    try {
      const domain = new URL(input.url).hostname;
      waybackData = await collectWayback(domain);
      if (waybackData.error) { errors.push('Wayback: ' + waybackData.error); }
      else { progress(`Wayback: ${waybackData.totalCaptures} captures, ${waybackData.uniqueUrls.length} unique URLs, first capture: ${waybackData.firstCapture}`); }
    } catch (e: any) { errors.push('Wayback failed: ' + e.message); }
  }

  // Phase 4: DNS Recon
  let dnsData: DnsData | undefined;
  if (input.depth !== 'quick') {
    progress('Running DNS reconnaissance...');
    try {
      dnsData = await collectDns(input.url);
      if (dnsData.error) { errors.push('DNS: ' + dnsData.error); }
      else { progress(`DNS: Email via ${dnsData.emailProvider}, ${dnsData.mxRecords.length} MX records`); }
    } catch (e: any) { errors.push('DNS failed: ' + e.message); }
  }

  // Phase 5: Tech stack
  let techData: TechStackData | undefined;
  if (websiteData && websiteData.rawHtml) {
    progress('Extracting tech stack...');
    techData = extractTechStack(websiteData.rawHtml);
    progress(`Tech: ${techData.cms} CMS, ${techData.analyticsIds.length} analytics IDs, ${techData.adPixels.length} ad pixels`);
  }

  // Phase 6: Generate content files
  progress('Generating dossier files...');
  filesCreated += generateCorporateFiles(dossierDir, input.companyName, {
    website: websiteData, wayback: waybackData, dns: dnsData, tech: techData
  });

  // Phase 7: Generate ROUTER.md
  progress('Building navigation index...');
  generateRouter(dossierDir, input.companyName);
  filesCreated++;

  progress(`Done! ${filesCreated} files created in ${input.companyName} DOSSIER/`);

  return {
    companyName: input.companyName,
    dossierPath: dossierDir,
    filesCreated,
    websiteData, waybackData, dnsData, techData,
    errors
  };
}
