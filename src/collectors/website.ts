import { fetchText, sleep } from '../utils';

export interface PageData {
  url: string;
  title: string;
  description: string;
  headings: string[];
  textContent: string;
}

export interface WebsiteData {
  url: string;
  title: string;
  description: string;
  keywords: string[];
  socialLinks: string[];
  emails: string[];
  phones: string[];
  schemaOrg: any | null;
  sitemapUrls: string[];
  robotsTxt: string;
  rawHtml: string;
  pages: PageData[];
  allEmails: string[];
  allPhones: string[];
  pageCount: number;
  error?: string;
}

export type ProgressCallback = (message: string) => void;

/** Strip HTML tags and collapse whitespace to extract readable text. */
function stripHtml(html: string): string {
  // Remove script/style blocks entirely
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  // Remove all remaining tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Decode common HTML entities
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

/** Extract title from HTML. */
function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>(.*?)<\/title>/is);
  return m ? m[1].trim() : '';
}

/** Extract meta description from HTML. */
function extractDescription(html: string): string {
  const m = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  return m ? m[1].trim() : '';
}

/** Extract H1 and H2 headings from HTML. */
function extractHeadings(html: string): string[] {
  const headings: string[] = [];
  const pattern = /<h[12][^>]*>(.*?)<\/h[12]>/gis;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const text = match[1].replace(/<[^>]+>/g, '').trim();
    if (text) { headings.push(text); }
  }
  return headings;
}

/** Extract emails from text/HTML. */
function extractEmails(text: string): string[] {
  const matches = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g);
  return matches ? [...new Set(matches)] : [];
}

/** Extract phone numbers from text/HTML. */
function extractPhones(text: string): string[] {
  const matches = text.match(/(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g);
  return matches ? [...new Set(matches)] : [];
}

/** Extract social media links from HTML. */
function extractSocialLinks(html: string): string[] {
  const patterns = [
    /https?:\/\/(?:www\.)?linkedin\.com\/company\/[^"'\s<>)]+/gi,
    /https?:\/\/(?:www\.)?twitter\.com\/[^"'\s<>)]+/gi,
    /https?:\/\/(?:www\.)?x\.com\/[^"'\s<>)]+/gi,
    /https?:\/\/(?:www\.)?facebook\.com\/[^"'\s<>)]+/gi,
    /https?:\/\/(?:www\.)?instagram\.com\/[^"'\s<>)]+/gi,
    /https?:\/\/(?:www\.)?youtube\.com\/(?:@|channel\/|c\/)[^"'\s<>)]+/gi,
    /https?:\/\/(?:www\.)?tiktok\.com\/@[^"'\s<>)]+/gi,
    /https?:\/\/(?:www\.)?github\.com\/[^"'\s<>)]+/gi,
  ];
  const links = new Set<string>();
  for (const pattern of patterns) {
    const matches = html.match(pattern);
    if (matches) {
      for (const m of matches) { links.add(m); }
    }
  }
  return [...links];
}

/** Parse all internal links from HTML, relative to given origin. */
function parseInternalLinks(html: string, origin: string): string[] {
  const urls = new Set<string>();
  const hrefPattern = /href=["']([^"'#]+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefPattern.exec(html)) !== null) {
    let href = match[1].trim();
    // Skip non-HTTP protocols, mailto, tel, javascript
    if (/^(mailto:|tel:|javascript:|data:|#)/i.test(href)) { continue; }
    try {
      const resolved = new URL(href, origin);
      // Only keep same-origin links
      if (resolved.origin === origin) {
        // Normalize: strip hash, keep path+query
        resolved.hash = '';
        urls.add(resolved.href);
      }
    } catch {
      // Skip malformed URLs
    }
  }
  return [...urls];
}

/** Parse sitemap.xml and return all URLs found. */
function parseSitemapUrls(xml: string): string[] {
  const urls: string[] = [];
  const locPattern = /<loc>(.*?)<\/loc>/g;
  let match: RegExpExecArray | null;
  while ((match = locPattern.exec(xml)) !== null) {
    urls.push(match[1].trim());
  }
  return urls;
}

/** Process a single page: fetch + extract structured data. */
async function processPage(url: string): Promise<{ page: PageData; html: string } | null> {
  try {
    const html = await fetchText(url, 10000);
    const page: PageData = {
      url,
      title: extractTitle(html),
      description: extractDescription(html),
      headings: extractHeadings(html),
      textContent: stripHtml(html).slice(0, 5000), // Cap per-page text at 5k chars
    };
    return { page, html };
  } catch {
    return null;
  }
}

export async function collectWebsite(
  baseUrl: string,
  progressCallback?: ProgressCallback
): Promise<WebsiteData> {
  const progress = progressCallback || (() => {});
  const origin = new URL(baseUrl).origin;

  const result: WebsiteData = {
    url: baseUrl, title: '', description: '', keywords: [],
    socialLinks: [], emails: [], phones: [],
    schemaOrg: null, sitemapUrls: [], robotsTxt: '', rawHtml: '',
    pages: [], allEmails: [], allPhones: [], pageCount: 0,
  };

  const allEmailSet = new Set<string>();
  const allPhoneSet = new Set<string>();
  const allSocialSet = new Set<string>();
  const crawledUrls = new Set<string>();
  const urlsToCrawl: string[] = [];

  // ---- Step 1: Fetch homepage ----
  progress('Fetching homepage...');
  try {
    const html = await fetchText(baseUrl, 15000);
    result.rawHtml = html;
    result.title = extractTitle(html);
    result.description = extractDescription(html);

    // Meta keywords
    const kwMatch = html.match(/<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']*)["']/i);
    if (kwMatch) { result.keywords = kwMatch[1].split(',').map(k => k.trim()).filter(Boolean); }

    // Schema.org JSON-LD
    const schemaMatches = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis);
    if (schemaMatches) {
      try { result.schemaOrg = JSON.parse(schemaMatches[0].replace(/<\/?script[^>]*>/gi, '')); } catch {}
    }

    // Extract contacts/social from homepage
    const homeEmails = extractEmails(html);
    const homePhones = extractPhones(html);
    const homeSocial = extractSocialLinks(html);
    homeEmails.forEach(e => allEmailSet.add(e));
    homePhones.forEach(p => allPhoneSet.add(p));
    homeSocial.forEach(s => allSocialSet.add(s));

    // Homepage as first page
    result.pages.push({
      url: baseUrl,
      title: result.title,
      description: result.description,
      headings: extractHeadings(html),
      textContent: stripHtml(html).slice(0, 5000),
    });
    crawledUrls.add(baseUrl);
    crawledUrls.add(baseUrl.replace(/\/$/, '')); // Normalize trailing slash

    // Parse internal links from homepage
    const homeLinks = parseInternalLinks(html, origin);
    for (const link of homeLinks) {
      if (!crawledUrls.has(link) && !crawledUrls.has(link.replace(/\/$/, ''))) {
        urlsToCrawl.push(link);
        crawledUrls.add(link);
      }
    }
    progress(`Homepage parsed. Found ${homeLinks.length} internal links.`);

  } catch (err: any) {
    result.error = err.message;
    return result;
  }

  // ---- Step 2: Fetch sitemap.xml ----
  progress('Fetching sitemap.xml...');
  try {
    const sitemapXml = await fetchText(origin + '/sitemap.xml', 10000);
    const sitemapUrls = parseSitemapUrls(sitemapXml);
    result.sitemapUrls = sitemapUrls.slice(0, 500);
    progress(`Sitemap: ${sitemapUrls.length} URLs found.`);

    // Add sitemap URLs to crawl queue
    for (const sUrl of sitemapUrls) {
      try {
        const parsed = new URL(sUrl);
        if (parsed.origin === origin && !crawledUrls.has(sUrl) && !crawledUrls.has(sUrl.replace(/\/$/, ''))) {
          urlsToCrawl.push(sUrl);
          crawledUrls.add(sUrl);
        }
      } catch {}
    }
  } catch {
    progress('Sitemap: not found or inaccessible.');
  }

  await sleep(500);

  // ---- Step 3: Fetch robots.txt ----
  try {
    result.robotsTxt = await fetchText(origin + '/robots.txt', 5000);
  } catch {}

  // ---- Step 4: Crawl internal pages (up to 50) ----
  const maxPages = 50;
  const pagesToCrawl = urlsToCrawl.slice(0, maxPages);
  progress(`Crawling up to ${pagesToCrawl.length} internal pages...`);

  for (let i = 0; i < pagesToCrawl.length; i++) {
    const pageUrl = pagesToCrawl[i];

    // Skip non-HTML resources
    if (/\.(jpg|jpeg|png|gif|svg|webp|ico|css|js|woff|woff2|ttf|eot|mp4|mp3|zip|gz|pdf)(\?|$)/i.test(pageUrl)) {
      continue;
    }

    if (i > 0) { await sleep(500); }

    progress(`[${i + 1}/${pagesToCrawl.length}] Crawling: ${pageUrl}`);

    try {
      const fetched = await processPage(pageUrl);
      if (fetched) {
        result.pages.push(fetched.page);

        // Extract contacts from this page
        const pageEmails = extractEmails(fetched.html);
        const pagePhones = extractPhones(fetched.html);
        const pageSocial = extractSocialLinks(fetched.html);
        pageEmails.forEach(e => allEmailSet.add(e));
        pagePhones.forEach(p => allPhoneSet.add(p));
        pageSocial.forEach(s => allSocialSet.add(s));

        // Discover new links from this page (add to queue if under limit)
        if (pagesToCrawl.length < maxPages) {
          const newLinks = parseInternalLinks(fetched.html, origin);
          for (const link of newLinks) {
            if (pagesToCrawl.length >= maxPages) { break; }
            if (!crawledUrls.has(link) && !crawledUrls.has(link.replace(/\/$/, ''))) {
              pagesToCrawl.push(link);
              crawledUrls.add(link);
            }
          }
        }
      }
    } catch {
      // One page failure should not stop the crawl
    }
  }

  // ---- Step 5: Assemble results ----
  result.allEmails = [...allEmailSet];
  result.allPhones = [...allPhoneSet];
  result.socialLinks = [...allSocialSet];
  result.emails = result.allEmails; // Keep backward compatibility
  result.phones = result.allPhones;
  result.pageCount = result.pages.length;

  progress(`Website crawl complete: ${result.pageCount} pages, ${result.allEmails.length} emails, ${result.allPhones.length} phones, ${result.socialLinks.length} social profiles.`);

  return result;
}
