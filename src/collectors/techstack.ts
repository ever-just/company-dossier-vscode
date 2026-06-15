export interface TechStackData {
  cms: string;
  analyticsIds: string[];
  gtmIds: string[];
  adPixels: string[];
  cdn: string;
  frameworks: string[];
  metaGenerator: string;
  error?: string;
}

export function extractTechStack(html: string, headers?: Record<string, string>): TechStackData {
  const result: TechStackData = {
    cms: 'Unknown', analyticsIds: [], gtmIds: [],
    adPixels: [], cdn: '', frameworks: [], metaGenerator: ''
  };

  try {
    // CMS detection
    if (html.includes('wix.com') || html.includes('X-Wix')) { result.cms = 'Wix'; }
    else if (html.includes('wp-content') || html.includes('wordpress')) { result.cms = 'WordPress'; }
    else if (html.includes('Shopify.theme') || html.includes('cdn.shopify')) { result.cms = 'Shopify'; }
    else if (html.includes('squarespace.com') || html.includes('static1.squarespace')) { result.cms = 'Squarespace'; }
    else if (html.includes('webflow.com')) { result.cms = 'Webflow'; }
    else if (html.includes('ghost.io')) { result.cms = 'Ghost'; }
    else if (html.includes('hubspot')) { result.cms = 'HubSpot'; }

    // Meta generator
    const genMatch = html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']*)["']/i);
    if (genMatch) { result.metaGenerator = genMatch[1]; }

    // Google Analytics
    const ga4Matches = html.match(/G-[A-Z0-9]{6,}/g);
    const uaMatches = html.match(/UA-\d{6,}-\d/g);
    if (ga4Matches) { result.analyticsIds.push(...new Set(ga4Matches)); }
    if (uaMatches) { result.analyticsIds.push(...new Set(uaMatches)); }

    // Google Tag Manager
    const gtmMatches = html.match(/GTM-[A-Z0-9]{4,}/g);
    if (gtmMatches) { result.gtmIds.push(...new Set(gtmMatches)); }

    // Ad pixels
    const fbPixel = html.match(/fbq\(['"]init['"],\s*['"](\d+)['"]/);
    if (fbPixel) { result.adPixels.push('Meta Pixel: ' + fbPixel[1]); }
    const ttPixel = html.match(/tiktok[^"']*pixel/i);
    if (ttPixel) { result.adPixels.push('TikTok Pixel'); }
    const liPixel = html.match(/linkedin\.com\/px|_linkedin_partner_id/i);
    if (liPixel) { result.adPixels.push('LinkedIn Insight Tag'); }
    const tdPixel = html.match(/thetradedesk|ttd/i);
    if (tdPixel) { result.adPixels.push('The Trade Desk'); }

    // Frameworks
    if (html.includes('react') || html.includes('__NEXT_DATA__')) { result.frameworks.push('React/Next.js'); }
    if (html.includes('vue') || html.includes('__VUE__')) { result.frameworks.push('Vue.js'); }
    if (html.includes('angular')) { result.frameworks.push('Angular'); }
    if (html.includes('svelte')) { result.frameworks.push('Svelte'); }

    // CDN
    if (html.includes('cloudflare')) { result.cdn = 'Cloudflare'; }
    else if (html.includes('fastly')) { result.cdn = 'Fastly'; }
    else if (html.includes('akamai')) { result.cdn = 'Akamai'; }
    else if (html.includes('cloudfront')) { result.cdn = 'CloudFront (AWS)'; }

  } catch (err: any) {
    result.error = err.message;
  }

  return result;
}
