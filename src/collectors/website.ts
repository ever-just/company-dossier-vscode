import { fetchText } from '../utils';

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
  error?: string;
}

export async function collectWebsite(baseUrl: string): Promise<WebsiteData> {
  const result: WebsiteData = {
    url: baseUrl, title: '', description: '', keywords: [],
    socialLinks: [], emails: [], phones: [],
    schemaOrg: null, sitemapUrls: [], robotsTxt: '', rawHtml: ''
  };

  try {
    // Fetch homepage
    const html = await fetchText(baseUrl);
    result.rawHtml = html;

    // Title
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/is);
    result.title = titleMatch ? titleMatch[1].trim() : '';

    // Meta description
    const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
    result.description = descMatch ? descMatch[1].trim() : '';

    // Meta keywords
    const kwMatch = html.match(/<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']*)["']/i);
    if (kwMatch) { result.keywords = kwMatch[1].split(',').map(k => k.trim()); }

    // Social links
    const socialPatterns = [/linkedin\.com\/company\/[^"'\s]+/g, /twitter\.com\/[^"'\s]+/g, /facebook\.com\/[^"'\s]+/g, /instagram\.com\/[^"'\s]+/g];
    for (const pattern of socialPatterns) {
      const matches = html.match(pattern);
      if (matches) { result.socialLinks.push(...matches.map(m => 'https://' + m)); }
    }

    // Email addresses
    const emailMatches = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
    if (emailMatches) { result.emails = [...new Set(emailMatches)]; }

    // Phone numbers
    const phoneMatches = html.match(/(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g);
    if (phoneMatches) { result.phones = [...new Set(phoneMatches)]; }

    // Schema.org JSON-LD
    const schemaMatches = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis);
    if (schemaMatches) {
      try { result.schemaOrg = JSON.parse(schemaMatches[0].replace(/<\/?script[^>]*>/gi, '')); } catch {}
    }

    // Sitemap
    try {
      const domain = new URL(baseUrl).origin;
      const sitemapXml = await fetchText(domain + '/sitemap.xml', 5000);
      const locMatches = sitemapXml.match(/<loc>(.*?)<\/loc>/g);
      if (locMatches) {
        result.sitemapUrls = locMatches.map(m => m.replace(/<\/?loc>/g, '')).slice(0, 200);
      }
    } catch {}

    // Robots.txt
    try {
      const domain = new URL(baseUrl).origin;
      result.robotsTxt = await fetchText(domain + '/robots.txt', 5000);
    } catch {}

  } catch (err: any) {
    result.error = err.message;
  }

  return result;
}
