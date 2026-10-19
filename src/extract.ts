// ---------------------------------------------------------------------------
// Per-page-type extractors — pull structured intelligence from HTML
// ---------------------------------------------------------------------------

import { PageType } from './classify';

// ---- Extracted data types ----

export interface PersonExtract {
  name: string;
  title?: string;
  linkedinUrl?: string;
  email?: string;
  photoUrl?: string;
  source: string;
}

export interface ProductExtract {
  name: string;
  description: string;
  url: string;
  pricingSignal?: string; // "Contact us", "$X/mo", "Free trial", "Request demo"
  features: string[];
  ctaText?: string;
}

export interface CaseStudyExtract {
  clientName: string;
  industry?: string;
  outcomes: string[];
  quote?: string;
  url: string;
}

export interface JobExtract {
  title: string;
  location?: string;
  department?: string;
}

export interface CareersExtract {
  openPositions: number;
  roles: JobExtract[];
  locations: string[];
  hiringSignals: string[];
}

export interface ContactExtract {
  emails: string[];
  phones: string[];
  addresses: string[];
  formUrl?: string;
}

export interface PartnerExtract {
  name: string;
  type?: string; // "technology", "channel", "integration"
  url?: string;
}

export interface PageExtractions {
  people: PersonExtract[];
  products: ProductExtract[];
  caseStudies: CaseStudyExtract[];
  careers?: CareersExtract;
  contacts: ContactExtract[];
  partners: PartnerExtract[];
  aboutText?: string;
  companyDescription?: string;
}

// ---- Helper functions ----

function stripHtml(html: string): string {
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

function extractEmails(text: string): string[] {
  const matches = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g);
  return matches ? [...new Set(matches)] : [];
}

function extractPhones(text: string): string[] {
  const matches = text.match(/(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g);
  return matches ? [...new Set(matches)] : [];
}

// Common job title patterns
const JOB_TITLE_PATTERNS = /\b(CEO|CTO|CFO|COO|CIO|CISO|CMO|CPO|VP|SVP|EVP|Director|Manager|Head of|President|Founder|Co-Founder|Partner|Principal|Lead|Senior|Junior|Architect|Engineer|Designer|Analyst|Consultant|Coordinator|Specialist|Associate|Administrator|Officer|Chief)\b/i;

// Name-like pattern: 2-4 capitalized words
const NAME_PATTERN = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g;

/**
 * Extract people from a team/about page.
 * Strategy: Look for structured sections with name + title patterns.
 */
export function extractPeople(html: string, url: string): PersonExtract[] {
  const people: PersonExtract[] = [];
  const seen = new Set<string>();

  // Strategy 1: Look for common team card patterns in HTML
  // Match <h3>Name</h3> <p>Title</p> or similar heading+text patterns
  const cardPatterns = [
    // h2/h3/h4 with name followed by p/span/div with title
    /<h[2-4][^>]*>([^<]+)<\/h[2-4]>\s*(?:<[^>]*>\s*)*<(?:p|span|div)[^>]*>([^<]*(?:CEO|CTO|CFO|COO|VP|Director|Manager|Head|President|Founder|Partner|Principal|Lead|Engineer|Designer|Officer|Chief)[^<]*)<\/(?:p|span|div)>/gi,
  ];

  for (const pattern of cardPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const name = stripHtml(match[1]).trim();
      const title = stripHtml(match[2]).trim();
      if (name.length > 2 && name.length < 60 && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        // Check for LinkedIn link near this section
        const nearbyHtml = html.slice(Math.max(0, match.index - 200), match.index + match[0].length + 200);
        const linkedinMatch = nearbyHtml.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/[^"'\s<>)]+/i);
        people.push({
          name,
          title: title || undefined,
          linkedinUrl: linkedinMatch?.[0],
          source: url,
        });
      }
    }
  }

  // Strategy 2: Look for JSON-LD Person schema
  const schemaPattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let schemaMatch;
  while ((schemaMatch = schemaPattern.exec(html)) !== null) {
    try {
      const data = JSON.parse(schemaMatch[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'Person' && item.name && !seen.has(item.name.toLowerCase())) {
          seen.add(item.name.toLowerCase());
          people.push({
            name: item.name,
            title: item.jobTitle,
            email: item.email,
            source: url,
          });
        }
      }
    } catch {}
  }

  // Strategy 3: Fallback — look for text blocks with name + title pattern
  // Strip HTML, find lines that look like "Name — Title" or "Name, Title"
  const text = stripHtml(html);
  const nameLinePat = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s*[,|–—·•]\s*([^,\n]{5,60})/g;
  let nameLineMatch;
  while ((nameLineMatch = nameLinePat.exec(text)) !== null) {
    const name = nameLineMatch[1].trim();
    const possibleTitle = nameLineMatch[2].trim();
    if (JOB_TITLE_PATTERNS.test(possibleTitle) && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      people.push({
        name,
        title: possibleTitle,
        source: url,
      });
    }
  }

  return people;
}

/**
 * Extract products/services from a product/service page.
 */
export function extractProducts(html: string, url: string, title: string): ProductExtract[] {
  const products: ProductExtract[] = [];
  const text = stripHtml(html);

  // Get meta description as product description
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  const description = descMatch ? descMatch[1].trim() : text.slice(0, 300);

  // Extract H1 as product name (fallback to page title)
  const h1Match = html.match(/<h1[^>]*>(.*?)<\/h1>/is);
  const productName = h1Match ? stripHtml(h1Match[1]).trim() : title;

  // Look for pricing signals
  let pricingSignal: string | undefined;
  if (/\$[\d,]+(?:\.\d{2})?(?:\s*\/\s*(?:mo|month|yr|year))?/i.test(text)) {
    const priceMatch = text.match(/\$[\d,]+(?:\.\d{2})?(?:\s*\/\s*(?:mo|month|yr|year))?/i);
    pricingSignal = priceMatch?.[0];
  } else if (/request\s+(?:a\s+)?(?:demo|quote|pricing)/i.test(text)) {
    pricingSignal = 'Request demo/quote';
  } else if (/contact\s+(?:us|sales)/i.test(text)) {
    pricingSignal = 'Contact sales';
  } else if (/free\s+(?:trial|tier|plan)/i.test(text)) {
    pricingSignal = 'Free tier available';
  }

  // Extract features from lists
  const features: string[] = [];
  const listPattern = /<li[^>]*>(.*?)<\/li>/gis;
  let listMatch;
  while ((listMatch = listPattern.exec(html)) !== null) {
    const item = stripHtml(listMatch[1]).trim();
    if (item.length > 5 && item.length < 200 && !item.includes('@') && !/^\d+$/.test(item)) {
      features.push(item);
      if (features.length >= 15) { break; }
    }
  }

  // Extract CTA text
  const ctaMatch = html.match(/<(?:a|button)[^>]*class=["'][^"']*(?:cta|btn|button|primary)[^"']*["'][^>]*>(.*?)<\/(?:a|button)>/is);
  const ctaText = ctaMatch ? stripHtml(ctaMatch[1]).trim() : undefined;

  if (productName) {
    products.push({
      name: productName,
      description,
      url,
      pricingSignal,
      features: features.slice(0, 10),
      ctaText,
    });
  }

  return products;
}

/**
 * Extract case study / client information.
 */
export function extractCaseStudy(html: string, url: string): CaseStudyExtract | null {
  const text = stripHtml(html);

  // H1 often contains client name for case studies
  const h1Match = html.match(/<h1[^>]*>(.*?)<\/h1>/is);
  const h1Text = h1Match ? stripHtml(h1Match[1]).trim() : '';

  // Try to extract client name — often in the H1 or in pattern "Client: X" or "Company: X"
  let clientName = '';
  const clientPatterns = [
    /(?:client|customer|company):\s*([A-Z][^\n|,]{2,50})/i,
    /(?:how|why)\s+([A-Z][^\s]+(?:\s+[A-Z][^\s]+){0,3})\s+(?:uses?|chose|selected|improved|increased|reduced|achieved)/i,
  ];
  for (const pat of clientPatterns) {
    const m = text.match(pat);
    if (m) { clientName = m[1].trim(); break; }
  }
  // Fallback: use H1 if it looks like a company name (not generic)
  if (!clientName && h1Text && h1Text.length < 80 && !/case study|success story|testimonial/i.test(h1Text)) {
    clientName = h1Text;
  }

  if (!clientName) { return null; }

  // Extract outcomes — look for numbers/percentages
  const outcomes: string[] = [];
  const outcomePatterns = /(\d+[%x×]\s*(?:increase|decrease|reduction|growth|improvement|faster|more|less|savings?|roi)[^.]*\.)/gi;
  let outcomeMatch;
  while ((outcomeMatch = outcomePatterns.exec(text)) !== null) {
    outcomes.push(outcomeMatch[1].trim());
    if (outcomes.length >= 5) { break; }
  }

  // Extract quotes
  const quoteMatch = html.match(/<blockquote[^>]*>(.*?)<\/blockquote>/is)
    || text.match(/"([^"]{20,300})"/);
  const quote = quoteMatch ? stripHtml(quoteMatch[1]).trim() : undefined;

  // Industry detection
  const industryPatterns = /\b(healthcare|finance|fintech|retail|e-?commerce|manufacturing|logistics|education|saas|technology|telecom|energy|government|defense|legal|real estate|hospitality|automotive|pharma|media|insurance|construction|agriculture)\b/i;
  const industryMatch = text.match(industryPatterns);

  return {
    clientName,
    industry: industryMatch?.[1],
    outcomes,
    quote,
    url,
  };
}

/**
 * Extract careers / hiring information.
 */
export function extractCareers(html: string, url: string): CareersExtract {
  const text = stripHtml(html);
  const roles: JobExtract[] = [];
  const locationSet = new Set<string>();
  const hiringSignals: string[] = [];

  // Extract job titles from headings or list items
  const headingPattern = /<h[2-4][^>]*>(.*?)<\/h[2-4]>/gis;
  let headingMatch;
  while ((headingMatch = headingPattern.exec(html)) !== null) {
    const heading = stripHtml(headingMatch[1]).trim();
    if (JOB_TITLE_PATTERNS.test(heading) && heading.length < 100) {
      roles.push({ title: heading });
    }
  }

  // Look for structured job listings (common patterns)
  const jobListPattern = /<(?:div|li|article)[^>]*class=["'][^"']*(?:job|position|opening|role|vacancy)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|li|article)>/gi;
  let jobMatch;
  while ((jobMatch = jobListPattern.exec(html)) !== null) {
    const block = jobMatch[1];
    const titleMatch = block.match(/<(?:h[2-5]|a|span)[^>]*>(.*?)<\/(?:h[2-5]|a|span)>/is);
    const locationMatch = block.match(/(?:location|office|remote)[:\s]*([^<,]{3,50})/i);
    if (titleMatch) {
      const title = stripHtml(titleMatch[1]).trim();
      if (title.length > 3 && title.length < 100) {
        roles.push({
          title,
          location: locationMatch ? locationMatch[1].trim() : undefined,
        });
        if (locationMatch) { locationSet.add(locationMatch[1].trim()); }
      }
    }
  }

  // Extract locations mentioned
  const locationPatterns = /(?:located in|offices? in|based in|remote|hybrid|on-site)\s+([^<,.\n]{3,50})/gi;
  let locMatch;
  while ((locMatch = locationPatterns.exec(text)) !== null) {
    locationSet.add(locMatch[1].trim());
  }

  // Hiring signals
  if (/\bwe'?re\s+hiring\b/i.test(text)) { hiringSignals.push('Active hiring banner'); }
  if (/\brapidly\s+growing\b/i.test(text)) { hiringSignals.push('Claims rapid growth'); }
  if (/\bremote[- ]first\b/i.test(text)) { hiringSignals.push('Remote-first workplace'); }
  if (/\bseries\s+[a-e]\b/i.test(text)) { hiringSignals.push('Recently funded (series mentioned)'); }

  // Count from text
  const countMatch = text.match(/(\d+)\s*(?:open|current)\s*(?:positions?|roles?|openings?|jobs?)/i);
  const openPositions = countMatch ? parseInt(countMatch[1]) : roles.length;

  return {
    openPositions,
    roles: roles.slice(0, 30),
    locations: [...locationSet],
    hiringSignals,
  };
}

/**
 * Extract contact information from a contact page.
 */
export function extractContact(html: string, url: string): ContactExtract {
  const text = stripHtml(html);

  const emails = extractEmails(text);
  const phones = extractPhones(text);

  // Extract addresses — look for patterns with state abbreviations or zip codes
  const addresses: string[] = [];
  const addrPattern = /(\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Za-z]+){1,5},?\s*(?:Suite|Ste|Unit|#|Apt)?\.?\s*\d*,?\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?,?\s*[A-Z]{2}\s*\d{5})/g;
  let addrMatch;
  while ((addrMatch = addrPattern.exec(text)) !== null) {
    addresses.push(addrMatch[1].trim());
  }

  // Detect contact form
  const hasForm = /<form/i.test(html);

  return {
    emails,
    phones,
    addresses,
    formUrl: hasForm ? url : undefined,
  };
}

/**
 * Extract partner/integration names from partner pages.
 */
export function extractPartners(html: string, url: string): PartnerExtract[] {
  const partners: PartnerExtract[] = [];
  const seen = new Set<string>();

  // Look for logos with alt text (common on partner pages)
  const imgPattern = /<img[^>]+alt=["']([^"']{3,60})["'][^>]*>/gi;
  let imgMatch;
  while ((imgMatch = imgPattern.exec(html)) !== null) {
    const alt = imgMatch[1].trim();
    // Filter out generic alts
    if (!/logo|icon|image|photo|banner|arrow|close|menu|search|chevron/i.test(alt) && !seen.has(alt.toLowerCase())) {
      seen.add(alt.toLowerCase());
      partners.push({ name: alt, url: undefined });
    }
  }

  // Look for partner names in headings
  const h3Pattern = /<h[2-4][^>]*>(.*?)<\/h[2-4]>/gis;
  let h3Match;
  while ((h3Match = h3Pattern.exec(html)) !== null) {
    const name = stripHtml(h3Match[1]).trim();
    if (name.length > 2 && name.length < 60 && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      // Check for link
      const linkMatch = h3Match[0].match(/href=["']([^"']+)["']/i);
      partners.push({ name, url: linkMatch?.[1] });
    }
  }

  return partners;
}

/**
 * Extract about/company description from about page.
 */
export function extractAboutText(html: string): string {
  // Get main content — strip nav, header, footer, sidebar
  let content = html.replace(/<(?:nav|header|footer|aside)[\s\S]*?<\/(?:nav|header|footer|aside)>/gi, '');
  content = content.replace(/<script[\s\S]*?<\/script>/gi, '');
  content = content.replace(/<style[\s\S]*?<\/style>/gi, '');

  // Get paragraphs from main content area
  const paragraphs: string[] = [];
  const pPattern = /<p[^>]*>(.*?)<\/p>/gis;
  let pMatch;
  while ((pMatch = pPattern.exec(content)) !== null) {
    const text = stripHtml(pMatch[1]).trim();
    if (text.length > 50) { // Skip short fragments
      paragraphs.push(text);
    }
  }

  return paragraphs.slice(0, 10).join('\n\n');
}

// ---------------------------------------------------------------------------
// Master extraction — run appropriate extractors based on page type
// ---------------------------------------------------------------------------

export function extractFromPage(
  html: string,
  url: string,
  title: string,
  pageType: PageType
): Partial<PageExtractions> {
  const result: Partial<PageExtractions> = {};

  switch (pageType) {
    case 'team':
      result.people = extractPeople(html, url);
      break;
    case 'about':
      result.aboutText = extractAboutText(html);
      result.people = extractPeople(html, url); // About pages sometimes list leadership
      break;
    case 'product':
    case 'service':
      result.products = extractProducts(html, url, title);
      break;
    case 'case_study':
      const cs = extractCaseStudy(html, url);
      if (cs) { result.caseStudies = [cs]; }
      break;
    case 'careers':
      result.careers = extractCareers(html, url);
      break;
    case 'contact':
      result.contacts = [extractContact(html, url)];
      break;
    case 'partner':
      result.partners = extractPartners(html, url);
      break;
    case 'pricing':
      result.products = extractProducts(html, url, title); // Pricing pages reveal products too
      break;
    default:
      // For other page types, still extract contacts and people if detectable
      const emails = extractEmails(stripHtml(html));
      const phones = extractPhones(stripHtml(html));
      if (emails.length || phones.length) {
        result.contacts = [{ emails, phones, addresses: [] }];
      }
      break;
  }

  return result;
}

/**
 * Merge multiple partial extractions into one consolidated result.
 */
export function mergeExtractions(parts: Partial<PageExtractions>[]): PageExtractions {
  const merged: PageExtractions = {
    people: [],
    products: [],
    caseStudies: [],
    contacts: [],
    partners: [],
  };

  const seenPeople = new Set<string>();
  const seenProducts = new Set<string>();
  const seenPartners = new Set<string>();

  for (const part of parts) {
    if (part.people) {
      for (const p of part.people) {
        const key = p.name.toLowerCase();
        if (!seenPeople.has(key)) {
          seenPeople.add(key);
          merged.people.push(p);
        }
      }
    }
    if (part.products) {
      for (const p of part.products) {
        const key = p.name.toLowerCase();
        if (!seenProducts.has(key)) {
          seenProducts.add(key);
          merged.products.push(p);
        }
      }
    }
    if (part.caseStudies) {
      merged.caseStudies.push(...part.caseStudies);
    }
    if (part.careers && !merged.careers) {
      merged.careers = part.careers;
    }
    if (part.contacts) {
      merged.contacts.push(...part.contacts);
    }
    if (part.partners) {
      for (const p of part.partners) {
        const key = p.name.toLowerCase();
        if (!seenPartners.has(key)) {
          seenPartners.add(key);
          merged.partners.push(p);
        }
      }
    }
    if (part.aboutText && !merged.aboutText) {
      merged.aboutText = part.aboutText;
    }
    if (part.companyDescription && !merged.companyDescription) {
      merged.companyDescription = part.companyDescription;
    }
  }

  return merged;
}
