import * as path from 'path';
import { collectWebsite, WebsiteData } from './collectors/website';
import { collectWayback, WaybackData } from './collectors/wayback';
import { collectDns, DnsData } from './collectors/dns';
import { extractTechStack, TechStackData } from './collectors/techstack';
import { collectSearch, SearchData } from './collectors/search';
import { scaffoldDossier } from './generators/scaffold';
import { generateCorporateFiles } from './generators/corporate';
import { generateRouter } from './generators/router';
import { fetchText, sleep, todayISO } from './utils';
import {
  ResearchInput,
  ResearchProgress,
  CrawledPage,
  LLMSynthesis,
  ResearchResult,
} from './types';

// Re-export the shared pipeline types so existing importers can keep using
// `from './agent'`. New code should prefer importing from './types'.
export {
  ResearchInput,
  ResearchProgress,
  CrawledPage,
  LLMSynthesis,
  ResearchResult,
};

// ---------------------------------------------------------------------------
// Deep page crawler — fetches up to `maxPages` from sitemap
// ---------------------------------------------------------------------------

async function deepCrawl(
  sitemapUrls: string[],
  baseUrl: string,
  maxPages: number,
  progress: ResearchProgress
): Promise<CrawledPage[]> {
  const pages: CrawledPage[] = [];
  const origin = new URL(baseUrl).origin;

  // Prioritize diverse page types: about, products, team, contact, blog
  const priorityPatterns = [
    /about/i, /team/i, /leadership/i, /contact/i, /product/i, /service/i,
    /solution/i, /pricing/i, /careers?/i, /blog/i, /news/i, /press/i,
    /partner/i, /client/i, /customer/i, /case.?stud/i, /testimonial/i,
    /portfolio/i, /industr/i, /faq/i, /privacy/i, /terms/i
  ];

  // Sort URLs: priority pages first, then the rest
  const sorted = [...sitemapUrls].sort((a, b) => {
    const aScore = priorityPatterns.findIndex(p => p.test(a));
    const bScore = priorityPatterns.findIndex(p => p.test(b));
    const aPriority = aScore >= 0 ? aScore : 999;
    const bPriority = bScore >= 0 ? bScore : 999;
    return aPriority - bPriority;
  });

  const toCrawl = sorted.slice(0, maxPages);
  progress(`Deep crawl: fetching ${toCrawl.length} pages from sitemap...`);

  // Crawl in batches of 5 with 300ms delay between batches
  const batchSize = 5;
  for (let i = 0; i < toCrawl.length; i += batchSize) {
    const batch = toCrawl.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (url) => {
        try {
          const html = await fetchText(url, 8000);
          const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/is);
          return {
            url,
            html,
            title: titleMatch ? titleMatch[1].trim() : '',
            status: 'ok' as const
          };
        } catch {
          return { url, html: '', title: '', status: 'error' as const };
        }
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        pages.push(r.value);
      }
    }

    if (i + batchSize < toCrawl.length) {
      await sleep(300);
    }
  }

  progress(`Deep crawl complete: ${pages.filter(p => p.status === 'ok').length}/${toCrawl.length} pages fetched`);
  return pages;
}

// ---------------------------------------------------------------------------
// Extended Wayback — 3 CDX queries (main, PDFs, subdomains)
// ---------------------------------------------------------------------------

async function extendedWayback(
  domain: string,
  progress: ResearchProgress
): Promise<WaybackData> {
  progress('Wayback Machine: querying main domain...');
  const mainData = await collectWayback(domain, progress);

  // Second query: explicit PDF search
  progress('Wayback Machine: searching for PDFs...');
  try {
    const pdfUrl = `https://web.archive.org/cdx/search/cdx?url=${domain}/*.pdf&output=json&fl=timestamp,original&collapse=original&limit=100`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const resp = await fetch(pdfUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'CompanyDossier/1.0 (VS Code Extension)' }
      });
      if (resp.ok) {
        const text = await resp.text();
        try {
          const data = JSON.parse(text);
          if (Array.isArray(data) && data.length > 1) {
            const newPdfs = data.slice(1).map((r: any) => r[1]);
            const existingSet = new Set(mainData.pdfUrls);
            for (const pdf of newPdfs) {
              if (!existingSet.has(pdf)) {
                mainData.pdfUrls.push(pdf);
              }
            }
          }
        } catch {}
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {}

  await sleep(1500); // Rate limit

  // Third query: subdomains
  progress('Wayback Machine: checking subdomains...');
  try {
    const subUrl = `https://web.archive.org/cdx/search/cdx?url=*.${domain}&output=json&fl=timestamp,original&collapse=original&limit=200`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const resp = await fetch(subUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'CompanyDossier/1.0 (VS Code Extension)' }
      });
      if (resp.ok) {
        const text = await resp.text();
        try {
          const data = JSON.parse(text);
          if (Array.isArray(data) && data.length > 1) {
            const subUrls = data.slice(1).map((r: any) => r[1]);
            const existingSet = new Set(mainData.uniqueUrls);
            for (const u of subUrls) {
              if (!existingSet.has(u)) {
                mainData.uniqueUrls.push(u);
              }
            }
            mainData.totalCaptures += subUrls.length;
          }
        } catch {}
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {}

  progress(`Wayback: ${mainData.totalCaptures} captures, ${mainData.pdfUrls.length} PDFs, ${mainData.uniqueUrls.length} unique URLs`);
  return mainData;
}

// ---------------------------------------------------------------------------
// LLM Synthesis via Claude API
// ---------------------------------------------------------------------------

async function synthesizeWithLLM(
  companyName: string,
  baseUrl: string,
  websiteData: WebsiteData | undefined,
  crawledPages: CrawledPage[],
  dnsData: DnsData | undefined,
  techData: TechStackData | undefined,
  waybackData: WaybackData | undefined,
  searchData: SearchData | undefined,
  apiKey: string,
  progress: ResearchProgress
): Promise<LLMSynthesis | undefined> {
  progress('LLM Synthesis: sending collected data to Claude for analysis...');

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey });

    // Build context from all collected data
    const pagesSummary = crawledPages
      .filter(p => p.status === 'ok')
      .slice(0, 30) // Limit to keep within token budget
      .map(p => {
        // Extract just text content, strip HTML, limit size
        const text = p.html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 2000);
        return `### Page: ${p.title || p.url}\nURL: ${p.url}\n${text}`;
      })
      .join('\n\n');

    const dnsContext = dnsData ? `
## DNS & Email Infrastructure
- Email provider: ${dnsData.emailProvider}
- MX records: ${dnsData.mxRecords.map(r => r.exchange).join(', ')}
- SPF: ${dnsData.spfRecord || 'None'}
- DMARC: ${dnsData.dmarcRecord || 'None'}
- Subdomains: ${dnsData.subdomains.join(', ') || 'None found'}
- Verification tokens: ${dnsData.verificationTokens.join(', ') || 'None'}` : '';

    const techContext = techData ? `
## Tech Stack
- CMS: ${techData.cms}
- Generator: ${techData.metaGenerator || 'Not detected'}
- CDN: ${techData.cdn || 'Not detected'}
- Frameworks: ${techData.frameworks.join(', ') || 'Not detected'}
- Analytics: ${techData.analyticsIds.join(', ') || 'None'}
- GTM: ${techData.gtmIds.join(', ') || 'None'}
- Ad pixels: ${techData.adPixels.join(', ') || 'None'}` : '';

    const waybackContext = waybackData && !waybackData.error ? `
## Wayback Machine History
- First capture: ${waybackData.firstCapture}
- Last capture: ${waybackData.lastCapture}
- Total captures: ${waybackData.totalCaptures}
- Unique URLs: ${waybackData.uniqueUrls.length}
- PDFs found: ${waybackData.pdfUrls.length}
${waybackData.pdfUrls.length > 0 ? '- PDF URLs: ' + waybackData.pdfUrls.slice(0, 10).join(', ') : ''}
- Deleted pages: ${waybackData.deletedPages.length}` : '';

    const searchContext = searchData ? `
## Public Records
### USASpending Federal Contracts (${searchData.usaSpendingContracts.length} found)
${searchData.usaSpendingContracts.slice(0, 10).map(c =>
  `- ${c.awardId}: $${c.totalObligation.toLocaleString()} from ${c.awardingAgency} (${c.startDate} - ${c.endDate}) — ${c.description}`
).join('\n') || 'No federal contracts found.'}

### Social Profiles (${searchData.socialProfiles.length} found)
${searchData.socialProfiles.map(p => `- ${p.platform}: ${p.url}`).join('\n') || 'None discovered.'}` : '';

    const websiteContext = websiteData ? `
## Homepage
- Title: ${websiteData.title}
- Description: ${websiteData.description}
- Emails: ${websiteData.emails.join(', ') || 'None'}
- Phones: ${websiteData.phones.join(', ') || 'None'}
- Social links: ${websiteData.socialLinks.join(', ') || 'None'}
- Sitemap URLs: ${websiteData.sitemapUrls.length}
- Schema.org: ${websiteData.schemaOrg ? JSON.stringify(websiteData.schemaOrg).slice(0, 1000) : 'None'}` : '';

    const prompt = `You are a competitive intelligence analyst. I have collected the following data about "${companyName}" (${baseUrl}). Analyze everything and produce a structured intelligence report.

# COLLECTED DATA

${websiteContext}

${techContext}

${dnsContext}

${waybackContext}

${searchContext}

## Crawled Pages (${crawledPages.filter(p => p.status === 'ok').length} pages)

${pagesSummary}

---

# INSTRUCTIONS

Based on ALL the data above, write exactly 4 sections. Be specific, cite evidence from the data, and do not make up information that is not supported by the collected data.

## SECTION 1: EXECUTIVE BRIEF
Write a 3-5 paragraph executive brief. Cover: what the company does, their apparent size/scale, key products or services, target market, and any notable observations. Ground every claim in evidence from the data.

## SECTION 2: SWOT ANALYSIS
Write a detailed SWOT analysis in this format:
### Strengths
- (bullet points with evidence)
### Weaknesses
- (bullet points with evidence)
### Opportunities
- (bullet points with reasoning)
### Threats
- (bullet points with reasoning)

## SECTION 3: KEY INTELLIGENCE FINDINGS
List the 5-15 most important intelligence findings from the data. Each finding should be a bullet point with: the finding, the evidence source, and the confidence level (High/Moderate/Low).

## SECTION 4: MANUAL RESEARCH REQUIRED
List specific areas where automated collection was insufficient and manual research would add value. Be specific about what to look for and where.

Separate each section with the exact delimiter: ===SECTION_BREAK===`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = message.content
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text)
      .join('\n');

    // Parse sections
    const sections = responseText.split('===SECTION_BREAK===').map(s => s.trim());

    const synthesis: LLMSynthesis = {
      executiveBrief: sections[0] || '',
      swotAnalysis: sections[1] || '',
      keyFindings: sections[2] || '',
      manualResearchNeeded: sections[3] || ''
    };

    // If splitting failed (Claude didn't use delimiters), try header-based split
    if (sections.length < 4) {
      const headerSplit = responseText.split(/^## SECTION \d+:/m).filter(s => s.trim());
      if (headerSplit.length >= 4) {
        synthesis.executiveBrief = headerSplit[0].trim();
        synthesis.swotAnalysis = headerSplit[1].trim();
        synthesis.keyFindings = headerSplit[2].trim();
        synthesis.manualResearchNeeded = headerSplit[3].trim();
      } else {
        // Fallback: put everything in executive brief
        synthesis.executiveBrief = responseText;
      }
    }

    progress('LLM Synthesis complete');
    return synthesis;

  } catch (err: any) {
    progress(`LLM Synthesis failed: ${err.message}`);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Main research pipeline
// ---------------------------------------------------------------------------

export async function runResearch(
  input: ResearchInput,
  workspaceRoot: string,
  progress: ResearchProgress
): Promise<ResearchResult> {
  const dossierDir = path.join(workspaceRoot, `${input.companyName} DOSSIER`);
  const errors: string[] = [];
  let filesCreated = 0;
  let crawledPages: CrawledPage[] = [];
  const domain = new URL(input.url).hostname.replace(/^www\./, '');

  // =========================================================================
  // Phase 1: Scaffold (instant — no dependencies)
  // =========================================================================
  progress('[1/7] Scaffolding dossier structure...');
  filesCreated += scaffoldDossier(dossierDir, input.companyName);

  // =========================================================================
  // Phase 2: PARALLEL COLLECTION — 4 independent streams at once
  //
  // Dependency graph:
  //   Website crawl ──┐
  //   Wayback CDX  ──┤──→ [wait for all] ──→ Tech stack ──→ LLM ──→ Files
  //   DNS recon    ──┤
  //   USASpending  ──┘
  //
  // These 4 have ZERO dependencies on each other. Run them all at once.
  // =========================================================================
  progress('[2/7] Launching parallel collection: website + Wayback + DNS + public search...');

  // --- Stream A: Website homepage + sitemap + deep crawl ---
  const websitePromise = (async (): Promise<WebsiteData | undefined> => {
    try {
      progress('  → Website: fetching homepage & sitemap...');
      const data = await collectWebsite(input.url, (msg) => progress('  → Website: ' + msg));
      if (data.error) {
        errors.push('Website: ' + data.error);
      } else {
        progress(`  → Website: "${data.title}" — ${data.pageCount} pages crawled, ${data.sitemapUrls.length} sitemap URLs`);
        // Deep crawl runs as part of this stream (depends on sitemap)
        const maxPages = input.depth === 'quick' ? 5 : input.depth === 'standard' ? 25 : 50;
        if (data.sitemapUrls.length > 0) {
          const pages = await deepCrawl(data.sitemapUrls, input.url, maxPages, (msg) => progress('  → ' + msg));
          crawledPages = pages;
        }
      }
      return data;
    } catch (e: any) {
      errors.push('Website fetch failed: ' + e.message);
      return undefined;
    }
  })();

  // --- Stream B: Wayback Machine (3 CDX queries) ---
  const waybackPromise = (async (): Promise<WaybackData | undefined> => {
    if (input.depth === 'quick') {
      progress('  → Wayback: skipped (quick mode)');
      return undefined;
    }
    try {
      progress('  → Wayback: querying CDX API...');
      const data = await extendedWayback(domain, (msg) => progress('  → Wayback: ' + msg));
      if (data.error) { errors.push('Wayback: ' + data.error); }
      return data;
    } catch (e: any) {
      errors.push('Wayback failed: ' + e.message);
      return undefined;
    }
  })();

  // --- Stream C: DNS reconnaissance ---
  const dnsPromise = (async (): Promise<DnsData | undefined> => {
    try {
      progress('  → DNS: querying MX, SPF, DMARC...');
      const data = await collectDns(input.url);
      if (data.error) { errors.push('DNS: ' + data.error); }
      else { progress(`  → DNS: ${data.emailProvider}, ${data.mxRecords.length} MX, ${data.subdomains.length} subdomains`); }
      return data;
    } catch (e: any) {
      errors.push('DNS failed: ' + e.message);
      return undefined;
    }
  })();

  // --- Stream D: USASpending + social profile HEAD probes ---
  // Social extraction from HTML waits for website crawl, but USASpending + HEAD probes don't
  const searchPromise = (async (): Promise<SearchData | undefined> => {
    try {
      progress('  → Search: querying USASpending + probing social profiles...');
      // Start with no page content — social extraction from HTML added after website finishes
      const data = await collectSearch(input.companyName, (msg) => progress('  → Search: ' + msg), []);
      if (data.error) { errors.push('Search: ' + data.error); }
      return data;
    } catch (e: any) {
      errors.push('Search failed: ' + e.message);
      return undefined;
    }
  })();

  // --- Wait for ALL parallel streams to complete ---
  progress('[3/7] Waiting for all collection streams...');
  const [websiteData, waybackData, dnsData, searchData] = await Promise.all([
    websitePromise, waybackPromise, dnsPromise, searchPromise
  ]);

  progress(`[3/7] Collection complete — ${errors.length} warnings`);

  // =========================================================================
  // Phase 4: Tech stack extraction (depends on: website crawl HTML)
  // =========================================================================
  progress('[4/7] Extracting tech stack from all crawled pages...');
  let techData: TechStackData | undefined;
  const allHtml: string[] = [];
  if (websiteData?.rawHtml) { allHtml.push(websiteData.rawHtml); }
  for (const page of crawledPages) {
    if (page.status === 'ok') { allHtml.push(page.html); }
  }
  if (allHtml.length > 0) {
    const combined = allHtml.join('\n');
    techData = extractTechStack(combined);
    progress(`[4/7] Tech: ${techData.cms} CMS, ${techData.analyticsIds.length} analytics, ${techData.adPixels.length} pixels`);
  }

  // Enrich social profiles with links found in crawled HTML (now available)
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
  }

  // =========================================================================
  // Phase 5: LLM Synthesis (depends on: ALL collected data)
  // =========================================================================
  let llmSynthesis: LLMSynthesis | undefined;
  if (input.apiKey) {
    progress('[5/7] LLM Synthesis — sending all collected data to Claude...');
    llmSynthesis = await synthesizeWithLLM(
      input.companyName, input.url,
      websiteData, crawledPages, dnsData, techData, waybackData, searchData,
      input.apiKey, progress
    );
  } else {
    progress('[5/7] LLM Synthesis — skipped (no API key)');
  }

  // =========================================================================
  // Phase 6: Generate files (depends on: all data + LLM output)
  // =========================================================================
  progress('[6/7] Generating dossier files...');
  filesCreated += generateCorporateFiles(dossierDir, input.companyName, {
    website: websiteData, wayback: waybackData, dns: dnsData, tech: techData,
    search: searchData, crawledPages, llmSynthesis
  });

  // =========================================================================
  // Phase 7: ROUTER.md (depends on: files existing)
  // =========================================================================
  progress('[7/7] Building navigation index...');
  generateRouter(dossierDir, input.companyName);
  filesCreated++;

  progress(`Done! ${filesCreated} files created in ${input.companyName} DOSSIER/`);

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
    llmSynthesis,
    errors
  };
}
