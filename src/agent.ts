import * as path from 'path';
import { collectWebsite, WebsiteData } from './collectors/website';
import { collectWayback, WaybackData } from './collectors/wayback';
import { collectDns, DnsData } from './collectors/dns';
import { extractTechStack, TechStackData } from './collectors/techstack';
import { collectSearch, SearchData } from './collectors/search';
import { classifyPage, classifyPages, PageType, PAGE_TYPE_PRIORITY } from './classify';
import { extractFromPage, mergeExtractions, PageExtractions } from './extract';
import { synthesizeWithLLM, LLMSynthesis, OnStage } from './llm';
import { generateDossierFiles } from './generators/files';

/**
 * Normalize any user input into a target URL + clean domain.
 * Handles bare domains, missing protocol, www, paths, query strings, subdomains.
 */
function normalizeTarget(raw: string): { url: string; domain: string } {
  let s = (raw || '').trim().replace(/^\s*https?:\/\//i, '').replace(/^www\./i, '');
  const host = s.split(/[\/?#]/)[0].toLowerCase();
  const url = 'https://' + s.replace(/\/+$/, '');
  return { url, domain: host };
}
import { pullSocialContent, SocialPullResult, SocialProfileStatus } from './collectors/social';
import { fetchText, sleep, todayISO } from './utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResearchInput {
  companyName: string;
  url: string;
  depth: 'quick' | 'standard' | 'deep';
  apiKey?: string;
  model?: string;
  focusText?: string;
  socialPull?: boolean;
  socialMaxPosts?: number;
  socialDownloadMedia?: boolean;
}

export type ResearchProgress = (message: string) => void;

export interface CrawledPage {
  url: string;
  html: string;
  title: string;
  status: 'ok' | 'error';
  pageType: PageType;
}

/** Live counts sent to sidebar during research */
export interface FindingsCounts {
  people: number;
  products: number;
  caseStudies: number;
  partners: number;
  emails: number;
  phones: number;
  socialProfiles: number;
  govContracts: number;
  pagesClassified: Map<PageType, number>;
}

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
  extractions: PageExtractions;
  socialData?: SocialPullResult;
  llmSynthesis?: LLMSynthesis;
  errors: string[];
  counts: FindingsCounts;
}

// ---------------------------------------------------------------------------
// Adaptive rules — checkpoint logic that adjusts strategy mid-run
// ---------------------------------------------------------------------------

interface AdaptiveContext {
  isSPA: boolean;            // Homepage had no useful text content
  noSitemap: boolean;        // No sitemap.xml found
  teamPageFound: boolean;    // At least one team/leadership page exists
  productPagesFound: number;
  caseStudyPagesFound: number;
  careersPageFound: boolean;
  isGovernmentContractor: boolean;
  waybackEmpty: boolean;
  crawlFailureRate: number;  // 0-1
}

function buildAdaptiveContext(
  websiteData: WebsiteData | undefined,
  crawledPages: CrawledPage[],
  searchData: SearchData | undefined
): AdaptiveContext {
  const okPages = crawledPages.filter(p => p.status === 'ok');
  const failedPages = crawledPages.filter(p => p.status === 'error');

  // SPA detection: homepage exists but has very little text after stripping
  let isSPA = false;
  if (websiteData?.rawHtml) {
    const textOnly = websiteData.rawHtml
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ').trim();
    isSPA = textOnly.length < 200 && websiteData.rawHtml.length > 5000;
  }

  const typeMap = new Map<PageType, number>();
  for (const page of okPages) {
    typeMap.set(page.pageType, (typeMap.get(page.pageType) || 0) + 1);
  }

  return {
    isSPA,
    noSitemap: !websiteData?.sitemapUrls?.length,
    teamPageFound: (typeMap.get('team') || 0) > 0,
    productPagesFound: (typeMap.get('product') || 0) + (typeMap.get('service') || 0),
    caseStudyPagesFound: typeMap.get('case_study') || 0,
    careersPageFound: (typeMap.get('careers') || 0) > 0,
    isGovernmentContractor: (searchData?.usaSpendingContracts?.length || 0) > 0,
    waybackEmpty: false, // Set later
    crawlFailureRate: crawledPages.length > 0 ? failedPages.length / crawledPages.length : 0,
  };
}

// ---------------------------------------------------------------------------
// Deep page crawler with classification
// ---------------------------------------------------------------------------

async function deepCrawl(
  sitemapUrls: string[],
  internalLinks: string[],
  baseUrl: string,
  maxPages: number,
  progress: ResearchProgress
): Promise<CrawledPage[]> {
  const pages: CrawledPage[] = [];
  const origin = new URL(baseUrl).origin;

  // Merge sitemap URLs with internal links from homepage, deduplicate
  const allUrls = new Set<string>();
  const urlList: string[] = [];
  for (const url of [...sitemapUrls, ...internalLinks]) {
    const normalized = url.replace(/\/$/, '');
    if (!allUrls.has(normalized)) {
      allUrls.add(normalized);
      urlList.push(url);
    }
  }

  // Pre-classify by URL to prioritize high-value pages
  const classified = urlList.map(url => ({
    url,
    estimatedType: classifyPage(url, ''),
  }));

  // Sort by intelligence value — team/about/product first, blog/legal last
  classified.sort((a, b) => {
    const aIdx = PAGE_TYPE_PRIORITY.indexOf(a.estimatedType);
    const bIdx = PAGE_TYPE_PRIORITY.indexOf(b.estimatedType);
    return aIdx - bIdx;
  });

  const toCrawl = classified.slice(0, maxPages);
  progress(`Deep crawl: ${toCrawl.length} pages queued (${urlList.length} total URLs, prioritized by type)`);

  // Crawl in batches of 5 with 300ms between batches
  const batchSize = 5;
  for (let i = 0; i < toCrawl.length; i += batchSize) {
    const batch = toCrawl.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async ({ url }) => {
        try {
          const html = await fetchText(url, 8000);
          const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/is);
          const title = titleMatch ? titleMatch[1].trim() : '';
          const pageType = classifyPage(url, title);
          return { url, html, title, status: 'ok' as const, pageType };
        } catch {
          return { url, html: '', title: '', status: 'error' as const, pageType: 'other' as PageType };
        }
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled') { pages.push(r.value); }
    }

    if (i + batchSize < toCrawl.length) { await sleep(300); }

    // Progress with page type breakdown
    const okCount = pages.filter(p => p.status === 'ok').length;
    if ((i + batchSize) % 15 === 0 || i + batchSize >= toCrawl.length) {
      progress(`Deep crawl: ${okCount}/${toCrawl.length} pages fetched`);
    }
  }

  // Re-classify with actual titles (more accurate than URL-only)
  for (const page of pages) {
    if (page.status === 'ok') {
      page.pageType = classifyPage(page.url, page.title);
    }
  }

  const okPages = pages.filter(p => p.status === 'ok');
  const typeBreakdown = new Map<PageType, number>();
  for (const p of okPages) {
    typeBreakdown.set(p.pageType, (typeBreakdown.get(p.pageType) || 0) + 1);
  }
  const breakdown = [...typeBreakdown.entries()].map(([t, c]) => `${t}:${c}`).join(', ');
  progress(`Deep crawl complete: ${okPages.length} pages → ${breakdown}`);

  return pages;
}

// ---------------------------------------------------------------------------
// Extended Wayback — 3 CDX queries
// ---------------------------------------------------------------------------

async function extendedWayback(
  domain: string,
  progress: ResearchProgress
): Promise<WaybackData> {
  progress('Wayback Machine: querying main domain...');
  const mainData = await collectWayback(domain, progress);

  // PDF search
  progress('Wayback Machine: searching for PDFs...');
  try {
    const pdfUrl = `https://web.archive.org/cdx/search/cdx?url=${domain}/*.pdf&output=json&fl=timestamp,original&collapse=original&limit=100`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const resp = await fetch(pdfUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'CompanyDossier/2.0 (VS Code Extension)' }
      });
      if (resp.ok) {
        const text = await resp.text();
        try {
          const data = JSON.parse(text);
          if (Array.isArray(data) && data.length > 1) {
            const existingSet = new Set(mainData.pdfUrls);
            for (const r of data.slice(1)) {
              if (!existingSet.has(r[1])) { mainData.pdfUrls.push(r[1]); }
            }
          }
        } catch {}
      }
    } finally { clearTimeout(timer); }
  } catch {}

  await sleep(1500);

  // Subdomain search
  progress('Wayback Machine: checking subdomains...');
  try {
    const subUrl = `https://web.archive.org/cdx/search/cdx?url=*.${domain}&output=json&fl=timestamp,original&collapse=original&limit=200`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const resp = await fetch(subUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'CompanyDossier/2.0 (VS Code Extension)' }
      });
      if (resp.ok) {
        const text = await resp.text();
        try {
          const data = JSON.parse(text);
          if (Array.isArray(data) && data.length > 1) {
            const existingSet = new Set(mainData.uniqueUrls);
            for (const r of data.slice(1)) {
              if (!existingSet.has(r[1])) { mainData.uniqueUrls.push(r[1]); }
            }
            mainData.totalCaptures += data.length - 1;
          }
        } catch {}
      }
    } finally { clearTimeout(timer); }
  } catch {}

  progress(`Wayback: ${mainData.totalCaptures} captures, ${mainData.pdfUrls.length} PDFs, ${mainData.uniqueUrls.length} unique URLs`);
  return mainData;
}

// ---------------------------------------------------------------------------
// Main research pipeline — 5 phases with checkpoints
// ---------------------------------------------------------------------------

export async function runResearch(
  input: ResearchInput,
  workspaceRoot: string,
  progress: ResearchProgress,
  onCounts?: (counts: FindingsCounts) => void,
  onSocialStatus?: (statuses: SocialProfileStatus[]) => void,
  onStage?: OnStage
): Promise<ResearchResult> {
  const dossierDir = path.join(workspaceRoot, `${input.companyName} DOSSIER`);
  const errors: string[] = [];
  let filesCreated = 0;
  let crawledPages: CrawledPage[] = [];
  const { url: targetUrl, domain } = normalizeTarget(input.url);

  // Live counts — updated and emitted throughout the pipeline
  const counts: FindingsCounts = {
    people: 0, products: 0, caseStudies: 0, partners: 0,
    emails: 0, phones: 0, socialProfiles: 0, govContracts: 0,
    pagesClassified: new Map(),
  };
  const emitCounts = () => { if (onCounts) { onCounts(counts); } };

  // =========================================================================
  // PHASE 1: (no scaffold) — folders are created dynamically from findings.
  // =========================================================================
  progress('[Phase 1/5] Starting research on ' + domain + '...');

  // =========================================================================
  // PHASE 2: COLLECT (parallel — 4 independent streams)
  //
  // Website crawl ──┐
  // Wayback CDX   ──┤──→ CHECKPOINT 1 ──→ Phase 3
  // DNS recon     ──┤
  // Public search ──┘
  // =========================================================================
  progress('[Phase 2/5] Collecting intelligence (parallel)...');
  onStage?.({ type: 'stage', stage: 'collect', status: 'active' });

  // --- Stream A: Website homepage + sitemap + deep crawl ---
  const websitePromise = (async (): Promise<WebsiteData | undefined> => {
    try {
      progress('  → Website: fetching homepage & sitemap...');
      const data = await collectWebsite(targetUrl, (msg) => progress('  → Website: ' + msg));
      if (data.error) {
        errors.push('Website: ' + data.error);
      } else {
        progress(`  → Website: "${data.title}" — ${data.pageCount} pages, ${data.sitemapUrls.length} sitemap URLs`);

        // Update counts
        counts.emails = data.allEmails?.length || 0;
        counts.phones = data.allPhones?.length || 0;
        emitCounts();

        // Deep crawl with intelligent page prioritization
        const maxPages = input.depth === 'quick' ? 10 : input.depth === 'standard' ? 30 : 50;
        const internalLinks = data.pages?.map(p => p.url) || [];
        const allUrls = [...data.sitemapUrls, ...internalLinks];

        if (allUrls.length > 0) {
          crawledPages = await deepCrawl(
            data.sitemapUrls, internalLinks, targetUrl, maxPages,
            (msg) => progress('  → ' + msg)
          );

          // Update classified page counts
          for (const page of crawledPages.filter(p => p.status === 'ok')) {
            counts.pagesClassified.set(
              page.pageType,
              (counts.pagesClassified.get(page.pageType) || 0) + 1
            );
          }
          emitCounts();
        }
      }
      return data;
    } catch (e: any) {
      errors.push('Website fetch failed: ' + e.message);
      return undefined;
    }
  })();

  // --- Stream B: Wayback Machine ---
  const waybackPromise = (async (): Promise<WaybackData | undefined> => {
    if (input.depth === 'quick') {
      progress('  → Wayback: skipped (quick mode)');
      return undefined;
    }
    try {
      const data = await extendedWayback(domain, (msg) => progress('  → Wayback: ' + msg));
      if (data.error) { errors.push('Wayback: ' + data.error); }
      return data;
    } catch (e: any) {
      errors.push('Wayback failed: ' + e.message);
      return undefined;
    }
  })();

  // --- Stream C: DNS ---
  const dnsPromise = (async (): Promise<DnsData | undefined> => {
    try {
      progress('  → DNS: querying MX, SPF, DMARC...');
      const data = await collectDns(targetUrl);
      if (data.error) { errors.push('DNS: ' + data.error); }
      else { progress(`  → DNS: ${data.emailProvider}, ${data.mxRecords.length} MX, ${data.subdomains.length} subdomains`); }
      return data;
    } catch (e: any) {
      errors.push('DNS failed: ' + e.message);
      return undefined;
    }
  })();

  // --- Stream D: Public search ---
  const searchPromise = (async (): Promise<SearchData | undefined> => {
    try {
      progress('  → Search: querying USASpending + probing social profiles...');
      const data = await collectSearch(input.companyName, (msg) => progress('  → Search: ' + msg), []);
      if (data.error) { errors.push('Search: ' + data.error); }
      counts.govContracts = data.usaSpendingContracts.length;
      counts.socialProfiles = data.socialProfiles.length;
      emitCounts();
      return data;
    } catch (e: any) {
      errors.push('Search failed: ' + e.message);
      return undefined;
    }
  })();

  // --- Wait for all ---
  const [websiteData, waybackData, dnsData, searchData] = await Promise.all([
    websitePromise, waybackPromise, dnsPromise, searchPromise
  ]);

  // =========================================================================
  // CHECKPOINT 1: Assess what we got, adapt strategy
  // =========================================================================
  const adaptive = buildAdaptiveContext(websiteData, crawledPages, searchData);
  adaptive.waybackEmpty = !waybackData || !!waybackData.error || waybackData.totalCaptures === 0;

  const checkpointNotes: string[] = [];

  if (adaptive.isSPA) {
    checkpointNotes.push('SPA detected — limited text extraction, LLM will compensate');
    // Could add: fetch Wayback cached version for pre-rendered content
  }
  if (adaptive.noSitemap) {
    checkpointNotes.push('No sitemap — crawled from homepage links only');
  }
  if (!adaptive.teamPageFound) {
    checkpointNotes.push('No team page found — people extraction limited to about page mentions');
  }
  if (adaptive.crawlFailureRate > 0.5) {
    checkpointNotes.push(`High crawl failure rate (${Math.round(adaptive.crawlFailureRate * 100)}%) — possible bot protection`);
  }
  if (adaptive.isGovernmentContractor) {
    checkpointNotes.push(`Government contractor — ${searchData?.usaSpendingContracts.length} federal awards found`);
  }

  if (checkpointNotes.length > 0) {
    progress(`[Checkpoint] ${checkpointNotes.join(' | ')}`);
  }

  progress(`[Phase 2/5] Collection complete — ${errors.length} warnings`);
  onStage?.({ type: 'stage', stage: 'collect', status: 'done', detail: websiteData?.pageCount ? `${websiteData.pageCount} pages` : 'site blocked — web research will cover it' });

  // =========================================================================
  // PHASE 3: EXTRACT & ENRICH
  //
  // Run per-page-type extractors on all crawled pages.
  // Then enrich with tech stack + social profile merging.
  // =========================================================================
  progress('[Phase 3/5] Extracting intelligence from pages...');

  // --- Per-page-type extraction ---
  const extractionParts: Array<ReturnType<typeof extractFromPage>> = [];

  const okPages = crawledPages.filter(p => p.status === 'ok');
  for (const page of okPages) {
    const extraction = extractFromPage(page.html, page.url, page.title, page.pageType);
    extractionParts.push(extraction);
  }

  // Also extract from homepage if we have it
  if (websiteData?.rawHtml) {
    const homeType = classifyPage(websiteData.url, websiteData.title);
    extractionParts.push(extractFromPage(websiteData.rawHtml, websiteData.url, websiteData.title, homeType));
  }

  // Also extract from the website collector's page data
  if (websiteData?.pages) {
    for (const page of websiteData.pages) {
      // These were already processed as text, but the homepage HTML was the raw
      // We already handled homepage above, skip it
      if (page.url === websiteData.url) { continue; }
      // For pages from the website collector, we don't have raw HTML — skip extraction
      // (they'll be covered by deep crawl if they were re-crawled)
    }
  }

  const extractions = mergeExtractions(extractionParts);

  // Update live counts from extractions
  counts.people = extractions.people.length;
  counts.products = extractions.products.length;
  counts.caseStudies = extractions.caseStudies.length;
  counts.partners = extractions.partners.length;
  emitCounts();

  progress(`  Extracted: ${extractions.people.length} people, ${extractions.products.length} products, ${extractions.caseStudies.length} case studies, ${extractions.partners.length} partners`);

  // --- Tech stack extraction ---
  progress('  Extracting tech stack...');
  let techData: TechStackData | undefined;
  const allHtml: string[] = [];
  if (websiteData?.rawHtml) { allHtml.push(websiteData.rawHtml); }
  for (const page of okPages) { allHtml.push(page.html); }
  if (allHtml.length > 0) {
    techData = extractTechStack(allHtml.join('\n'));
    progress(`  Tech: ${techData.cms} CMS, ${techData.analyticsIds.length} analytics, ${techData.adPixels.length} pixels`);
  }

  // --- Enrich social profiles from crawled HTML ---
  if (searchData && websiteData?.socialLinks) {
    const existingUrls = new Set(searchData.socialProfiles.map(p => p.url));
    for (const link of websiteData.socialLinks) {
      if (!existingUrls.has(link)) {
        const platform = link.includes('linkedin') ? 'LinkedIn'
          : link.includes('twitter') || link.includes('x.com') ? 'X/Twitter'
          : link.includes('facebook') ? 'Facebook'
          : link.includes('instagram') ? 'Instagram'
          : link.includes('youtube') ? 'YouTube'
          : link.includes('tiktok') ? 'TikTok'
          : link.includes('github') ? 'GitHub'
          : 'Other';
        searchData.socialProfiles.push({ platform, url: link, source: 'website-html' });
      }
    }
    counts.socialProfiles = searchData.socialProfiles.length;
  }

  // Merge emails/phones from extractions
  if (extractions.contacts.length > 0) {
    const allExEmails = new Set(websiteData?.allEmails || []);
    const allExPhones = new Set(websiteData?.allPhones || []);
    for (const contact of extractions.contacts) {
      for (const e of contact.emails) { allExEmails.add(e); }
      for (const p of contact.phones) { allExPhones.add(p); }
    }
    counts.emails = allExEmails.size;
    counts.phones = allExPhones.size;
  }
  emitCounts();

  // =========================================================================
  // CHECKPOINT 2: Pre-LLM assessment
  // =========================================================================
  const hasRichData = extractions.people.length > 0 || extractions.products.length > 0 || extractions.caseStudies.length > 0;
  if (!hasRichData && !adaptive.isSPA) {
    progress('[Checkpoint] Limited extraction — LLM analysis will be especially valuable for inferring from raw content');
  }

  // =========================================================================
  // PHASE 3.5: SOCIAL CONTENT PULL
  //
  // Pull public content from discovered social media profiles.
  // Runs after profile discovery but before LLM synthesis so the AI can
  // analyze social content too.
  // =========================================================================
  let socialData: SocialPullResult | undefined;

  // Gather all discovered social URLs
  const socialUrls: string[] = [];
  if (searchData?.socialProfiles) {
    for (const p of searchData.socialProfiles) { socialUrls.push(p.url); }
  }
  if (websiteData?.socialLinks) {
    for (const link of websiteData.socialLinks) {
      if (!socialUrls.includes(link)) { socialUrls.push(link); }
    }
  }

  const doSocialPull = input.socialPull !== false && input.depth !== 'quick';

  if (socialUrls.length > 0 && doSocialPull) {
    progress('[Phase 3.5/5] Pulling social media content...');

    const maxPosts = input.socialMaxPosts || (input.depth === 'deep' ? 50 : 20);
    const dlMedia = input.socialDownloadMedia ?? (input.depth === 'deep');

    const socialOutputDir = path.join(dossierDir, '8_marketing', 'social_content');
    socialData = await pullSocialContent(
      socialUrls,
      socialOutputDir,
      {
        maxPostsPerPlatform: maxPosts,
        downloadMedia: dlMedia,
        enabledPlatforms: ['instagram', 'tiktok', 'youtube', 'facebook', 'pinterest'],
      },
      (msg) => progress('  → ' + msg),
      (statuses) => {
        // Emit social statuses to sidebar
        if (onSocialStatus) { onSocialStatus(statuses); }
        const totalSocial = statuses.reduce((sum, s) => sum + s.itemCount, 0);
        counts.socialProfiles = (searchData?.socialProfiles.length || 0) + totalSocial;
        emitCounts();
      }
    );

    if (socialData.totalItems > 0) {
      progress(`[Phase 3.5/5] Social content: ${socialData.totalItems} items from ${socialData.profiles.filter(p => p.status === 'done').length} platforms`);
    }
    for (const err of socialData.errors) {
      errors.push(err);
    }
  } else if (input.depth === 'quick') {
    progress('[Phase 3.5/5] Social content — skipped (quick mode)');
  } else {
    progress('[Phase 3.5/5] Social content — no social profiles discovered');
  }

  // =========================================================================
  // PHASE 4: AI ANALYSIS (if API key provided)
  // =========================================================================
  let llmSynthesis: LLMSynthesis | undefined;
  if (input.apiKey) {
    progress('[Phase 4/5] AI Analysis...');

    // Build page text summaries for LLM — classified and prioritized
    const pageTexts = okPages
      .sort((a, b) => PAGE_TYPE_PRIORITY.indexOf(a.pageType) - PAGE_TYPE_PRIORITY.indexOf(b.pageType))
      .map(p => {
        const text = p.html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        return { url: p.url, title: p.title, text, type: p.pageType };
      });

    llmSynthesis = await synthesizeWithLLM(
      {
        companyName: input.companyName,
        baseUrl: targetUrl,
        domain,
        website: websiteData,
        wayback: waybackData,
        dns: dnsData,
        tech: techData,
        search: searchData,
        extractions,
        pageTexts,
        focusText: input.focusText,
        model: input.model,
      },
      input.apiKey,
      input.depth,
      (msg) => progress('  → ' + msg),
      onStage
    );
  } else {
    progress('[Phase 4/5] AI Analysis — skipped (no API key)');
  }

  // =========================================================================
  // PHASE 5: GENERATE (files + router)
  // =========================================================================
  progress('[Phase 5/5] Generating dossier files...');
  onStage?.({ type: 'stage', stage: 'generate', status: 'active' });

  filesCreated += generateDossierFiles(dossierDir, input.companyName, {
    website: websiteData,
    wayback: waybackData,
    dns: dnsData,
    tech: techData,
    search: searchData,
    llmSynthesis,
    socialData,
    apiKeyProvided: !!input.apiKey,
    baseUrl: targetUrl,
  });

  onStage?.({ type: 'stage', stage: 'generate', status: 'done', detail: `${filesCreated} files` });
  progress(`Done! ${filesCreated} files created in ${input.companyName} DOSSIER/`);
  emitCounts();

  return {
    companyName: input.companyName,
    dossierPath: dossierDir,
    filesCreated,
    websiteData,
    waybackData,
    dnsData,
    techData,
    searchData,
    crawledPages,
    extractions,
    socialData,
    llmSynthesis,
    errors,
    counts,
  };
}
