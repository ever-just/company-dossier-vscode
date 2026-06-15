import { fetchText, fetchJSON, sleep } from '../utils';

export type ProgressCallback = (message: string) => void;

export interface SearchData {
  companyName: string;
  usaSpendingAwards: number;
  usaSpendingTotal: number;
  usaSpendingContracts: USASpendingContract[];
  youtubeVideos: Array<{ title: string; url: string }>;
  socialProfiles: Array<{ platform: string; url: string; source: string }>;
  newsArticles: Array<{ title: string; url: string }>;
  pressReleases: Array<{ title: string; url: string }>;
  error?: string;
}

export interface USASpendingContract {
  awardId: string;
  recipientName: string;
  totalObligation: number;
  awardingAgency: string;
  startDate: string;
  endDate: string;
  description: string;
}

/** Try a HEAD request to check if a URL exists (200, 301, 302 = exists). */
async function urlExists(url: string, timeoutMs = 8000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'manual',
      headers: { 'User-Agent': 'CompanyDossier/1.0 (VS Code Extension)' },
    });
    const status = resp.status;
    return status === 200 || status === 301 || status === 302;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Generate slug variations from a company name. */
function generateSlugs(companyName: string): string[] {
  const base = companyName.toLowerCase().trim();
  const slugs = new Set<string>();

  // "Acme Corp" -> "acmecorp", "acme-corp", "acme_corp"
  slugs.add(base.replace(/[^a-z0-9]/g, ''));
  slugs.add(base.replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').replace(/^-+/, ''));
  slugs.add(base.replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '').replace(/^_+/, ''));

  // Without common suffixes: "Inc", "LLC", "Corp", "Ltd", "Co"
  const stripped = base.replace(/\b(inc|llc|corp|corporation|ltd|limited|co|company|group|holdings)\b/gi, '').trim();
  if (stripped && stripped !== base) {
    slugs.add(stripped.replace(/[^a-z0-9]/g, ''));
    slugs.add(stripped.replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').replace(/^-+/, ''));
  }

  return [...slugs].filter(s => s.length > 1);
}

/** Filter out generic social handles that are not company-specific. */
function isGenericHandle(handle: string): boolean {
  const generic = new Set([
    'share', 'sharer', 'intent', 'home', 'search', 'login',
    'signup', 'about', 'help', 'support', 'privacy', 'terms',
    'policy', 'hashtag', 'explore', 'settings', 'legal',
  ]);
  return generic.has(handle.toLowerCase());
}

/** Query USASpending.gov for federal contract awards. */
async function queryUSASpending(
  companyName: string,
  progress: ProgressCallback
): Promise<{ awards: number; total: number; contracts: USASpendingContract[] }> {
  progress('Search: Querying USASpending.gov...');
  try {
    const body = JSON.stringify({
      filters: {
        recipient_search_text: [companyName],
        time_period: [{ start_date: '2010-01-01', end_date: new Date().toISOString().split('T')[0] }],
        award_type_codes: ['A', 'B', 'C', 'D'], // contracts
      },
      fields: [
        'Award ID', 'Recipient Name', 'Total Obligation',
        'Awarding Agency', 'Start Date', 'End Date', 'Description',
      ],
      limit: 25,
      page: 1,
      sort: 'Total Obligation',
      order: 'desc',
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const resp = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'CompanyDossier/1.0 (VS Code Extension)',
        },
        body,
      });

      if (!resp.ok) {
        progress(`USASpending: HTTP ${resp.status}`);
        return { awards: 0, total: 0, contracts: [] };
      }

      const data: any = await resp.json();
      const awards = data.page_metadata?.total || 0;
      const contracts: USASpendingContract[] = [];
      let total = 0;

      if (data.results && Array.isArray(data.results)) {
        for (const r of data.results) {
          const amt = parseFloat(r['Total Obligation'] || '0');
          if (!isNaN(amt)) { total += amt; }
          contracts.push({
            awardId: r['Award ID'] || '',
            recipientName: r['Recipient Name'] || '',
            totalObligation: amt,
            awardingAgency: r['Awarding Agency'] || '',
            startDate: r['Start Date'] || '',
            endDate: r['End Date'] || '',
            description: r['Description'] || '',
          });
        }
      }

      progress(`USASpending: ${awards} awards found, $${Math.round(total).toLocaleString()} total.`);
      return { awards, total, contracts };
    } finally {
      clearTimeout(timer);
    }
  } catch (err: any) {
    progress('USASpending: query failed — ' + err.message);
    return { awards: 0, total: 0, contracts: [] };
  }
}

/** Discover social media profiles by HEAD-checking common platform URLs. */
async function discoverSocialProfiles(
  companyName: string,
  progress: ProgressCallback
): Promise<Array<{ platform: string; url: string; source: string }>> {
  const slugs = generateSlugs(companyName);
  const profiles: Array<{ platform: string; url: string; source: string }> = [];
  const checked = new Set<string>();

  const platforms = [
    { name: 'LinkedIn', template: (s: string) => `https://www.linkedin.com/company/${s}` },
    { name: 'Twitter/X', template: (s: string) => `https://x.com/${s}` },
    { name: 'Facebook', template: (s: string) => `https://www.facebook.com/${s}` },
    { name: 'Instagram', template: (s: string) => `https://www.instagram.com/${s}` },
    { name: 'YouTube', template: (s: string) => `https://www.youtube.com/@${s}` },
    { name: 'TikTok', template: (s: string) => `https://www.tiktok.com/@${s}` },
    { name: 'GitHub', template: (s: string) => `https://github.com/${s}` },
  ];

  progress(`Search: Probing social profiles for ${slugs.length} slug(s) across ${platforms.length} platforms...`);

  for (const platform of platforms) {
    for (const slug of slugs) {
      const url = platform.template(slug);
      if (checked.has(url)) { continue; }
      checked.add(url);

      // Skip if we already found this platform
      if (profiles.some(p => p.platform === platform.name)) { break; }

      await sleep(1000);
      progress(`Search: Checking ${platform.name} — ${slug}...`);

      try {
        const exists = await urlExists(url);
        if (exists) {
          profiles.push({ platform: platform.name, url, source: 'HEAD probe' });
          progress(`Search: Found ${platform.name} profile!`);
          break; // Move to next platform
        }
      } catch {
        // Skip failures silently
      }
    }
  }

  progress(`Search: ${profiles.length} social profiles discovered via probing.`);
  return profiles;
}

/** Extract social profiles found in already-crawled page HTML. */
function extractSocialFromPages(pageContents: string[]): Array<{ platform: string; url: string; source: string }> {
  const socialPatterns: Array<{ platform: string; regex: RegExp }> = [
    { platform: 'LinkedIn', regex: /https?:\/\/(?:www\.)?linkedin\.com\/company\/([a-zA-Z0-9_-]+)/g },
    { platform: 'Twitter/X', regex: /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/g },
    { platform: 'Facebook', regex: /https?:\/\/(?:www\.)?facebook\.com\/([a-zA-Z0-9._-]+)/g },
    { platform: 'Instagram', regex: /https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._]+)/g },
    { platform: 'YouTube', regex: /https?:\/\/(?:www\.)?youtube\.com\/(?:@|channel\/|c\/|user\/)([a-zA-Z0-9_-]+)/g },
    { platform: 'GitHub', regex: /https?:\/\/(?:www\.)?github\.com\/([a-zA-Z0-9_-]+)/g },
    { platform: 'TikTok', regex: /https?:\/\/(?:www\.)?tiktok\.com\/@([a-zA-Z0-9._]+)/g },
    { platform: 'Pinterest', regex: /https?:\/\/(?:www\.)?pinterest\.com\/([a-zA-Z0-9_-]+)/g },
    { platform: 'Glassdoor', regex: /https?:\/\/(?:www\.)?glassdoor\.com\/Overview\/[^"'\s]+/g },
    { platform: 'Crunchbase', regex: /https?:\/\/(?:www\.)?crunchbase\.com\/organization\/([a-zA-Z0-9_-]+)/g },
  ];

  const profiles: Array<{ platform: string; url: string; source: string }> = [];
  const seen = new Set<string>();
  const allHtml = pageContents.join('\n');

  for (const { platform, regex } of socialPatterns) {
    let match;
    while ((match = regex.exec(allHtml)) !== null) {
      const fullUrl = match[0];
      const handle = match[1] || fullUrl;
      const key = platform + ':' + handle.toLowerCase();
      if (!seen.has(key) && !isGenericHandle(handle)) {
        seen.add(key);
        profiles.push({
          platform,
          url: fullUrl.startsWith('http') ? fullUrl : 'https://' + fullUrl,
          source: 'website crawl',
        });
      }
    }
  }

  return profiles;
}

/**
 * Deep search collector: queries public APIs and probes social platforms.
 *
 * Combines three strategies:
 * 1. USASpending.gov API for federal contract awards
 * 2. HEAD-request probing of social platform URLs
 * 3. Extraction of social links from already-crawled page HTML (if provided)
 */
export async function collectSearch(
  companyName: string,
  progressCallback?: ProgressCallback,
  pageContents?: string[]
): Promise<SearchData> {
  const progress = progressCallback || (() => {});

  const result: SearchData = {
    companyName,
    usaSpendingAwards: 0,
    usaSpendingTotal: 0,
    usaSpendingContracts: [],
    youtubeVideos: [],
    socialProfiles: [],
    newsArticles: [],
    pressReleases: [],
  };

  // ---- USASpending.gov ----
  try {
    const spending = await queryUSASpending(companyName, progress);
    result.usaSpendingAwards = spending.awards;
    result.usaSpendingTotal = spending.total;
    result.usaSpendingContracts = spending.contracts;
  } catch (err: any) {
    progress('USASpending error: ' + err.message);
  }

  await sleep(1000);

  // ---- Social profile discovery via HEAD probing ----
  try {
    const probed = await discoverSocialProfiles(companyName, progress);
    result.socialProfiles.push(...probed);
  } catch (err: any) {
    progress('Social probe error: ' + err.message);
  }

  // ---- Social profile extraction from crawled pages ----
  if (pageContents && pageContents.length > 0) {
    progress('Search: Extracting social profiles from crawled pages...');
    try {
      const extracted = extractSocialFromPages(pageContents);
      // Merge without duplicates (by platform+url)
      const existingKeys = new Set(result.socialProfiles.map(p => p.platform + ':' + p.url));
      for (const profile of extracted) {
        const key = profile.platform + ':' + profile.url;
        if (!existingKeys.has(key)) {
          result.socialProfiles.push(profile);
          existingKeys.add(key);
        }
      }
      progress(`Search: ${extracted.length} social profiles extracted from page content.`);
    } catch (err: any) {
      progress('Social extraction error: ' + err.message);
    }
  }

  progress(`Search complete: ${result.usaSpendingAwards} gov awards, ${result.socialProfiles.length} social profiles.`);

  return result;
}
