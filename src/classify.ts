// ---------------------------------------------------------------------------
// Page classifier — URL + title heuristics → page type
// ---------------------------------------------------------------------------

export type PageType =
  | 'about'
  | 'team'
  | 'product'
  | 'service'
  | 'pricing'
  | 'case_study'
  | 'careers'
  | 'contact'
  | 'blog'
  | 'news'
  | 'legal'
  | 'faq'
  | 'partner'
  | 'investor'
  | 'home'
  | 'other';

interface ClassificationRule {
  type: PageType;
  urlPatterns: RegExp[];
  titlePatterns: RegExp[];
  weight: number; // Higher = checked first
}

const RULES: ClassificationRule[] = [
  {
    type: 'team',
    urlPatterns: [/\/team\b/i, /\/people\b/i, /\/leadership\b/i, /\/staff\b/i, /\/our-team/i, /\/management/i, /\/executives/i, /\/board/i, /\/who-we-are/i],
    titlePatterns: [/\bteam\b/i, /\bleadership\b/i, /\bour people\b/i, /\bmanagement\b/i, /\bexecutives?\b/i, /\bstaff\b/i, /\bboard of/i],
    weight: 10,
  },
  {
    type: 'about',
    urlPatterns: [/\/about/i, /\/company\b/i, /\/who-we-are/i, /\/our-story/i, /\/mission/i, /\/history/i, /\/overview/i],
    titlePatterns: [/\babout\b/i, /\bour story\b/i, /\bwho we are\b/i, /\bour mission\b/i, /\bcompany overview\b/i],
    weight: 9,
  },
  {
    type: 'contact',
    urlPatterns: [/\/contact/i, /\/get-in-touch/i, /\/reach-us/i, /\/locations?$/i, /\/offices?$/i],
    titlePatterns: [/\bcontact\b/i, /\bget in touch\b/i, /\breach us\b/i, /\bour offices?\b/i],
    weight: 9,
  },
  {
    type: 'careers',
    urlPatterns: [/\/careers?\b/i, /\/jobs?\b/i, /\/hiring\b/i, /\/openings\b/i, /\/work-with-us/i, /\/join/i],
    titlePatterns: [/\bcareers?\b/i, /\bjobs?\b/i, /\bhiring\b/i, /\bjoin (us|our)/i, /\bopen positions\b/i],
    weight: 8,
  },
  {
    type: 'case_study',
    urlPatterns: [/\/case[_-]?stud/i, /\/success[_-]?stor/i, /\/testimonial/i, /\/client[_-]?stor/i, /\/portfolio\b/i, /\/results\b/i, /\/work\b/i],
    titlePatterns: [/\bcase stud/i, /\bsuccess stor/i, /\btestimonial/i, /\bclient stor/i, /\bour work\b/i],
    weight: 8,
  },
  {
    type: 'product',
    urlPatterns: [/\/products?\b/i, /\/platform\b/i, /\/features?\b/i, /\/capabilities/i, /\/catalog/i, /\/shop\b/i, /\/store\b/i],
    titlePatterns: [/\bproducts?\b/i, /\bplatform\b/i, /\bfeatures?\b/i, /\bcapabilities\b/i, /\bcatalog\b/i],
    weight: 7,
  },
  {
    type: 'service',
    urlPatterns: [/\/services?\b/i, /\/solutions?\b/i, /\/offerings?\b/i, /\/what-we-do/i, /\/consulting/i, /\/managed/i],
    titlePatterns: [/\bservices?\b/i, /\bsolutions?\b/i, /\bofferings?\b/i, /\bwhat we do\b/i],
    weight: 7,
  },
  {
    type: 'pricing',
    urlPatterns: [/\/pricing/i, /\/plans?\b/i, /\/packages?/i, /\/cost/i, /\/quote/i],
    titlePatterns: [/\bpricing\b/i, /\bplans?\b/i, /\bpackages?\b/i, /\bhow much/i, /\bget a quote\b/i],
    weight: 7,
  },
  {
    type: 'partner',
    urlPatterns: [/\/partners?\b/i, /\/alliance/i, /\/reseller/i, /\/channel/i, /\/ecosystem/i, /\/integrations?\b/i],
    titlePatterns: [/\bpartners?\b/i, /\balliance/i, /\breseller/i, /\bintegrations?\b/i, /\becosystem\b/i],
    weight: 6,
  },
  {
    type: 'investor',
    urlPatterns: [/\/investor/i, /\/ir\b/i, /\/shareholders?\b/i, /\/annual-report/i, /\/sec-filings/i],
    titlePatterns: [/\binvestor/i, /\bshareholders?\b/i, /\bannual report\b/i, /\bsec filing/i],
    weight: 6,
  },
  {
    type: 'blog',
    urlPatterns: [/\/blog\b/i, /\/articles?\b/i, /\/insights?\b/i, /\/resources?\b/i, /\/learn\b/i, /\/library\b/i, /\/knowledge/i],
    titlePatterns: [/\bblog\b/i, /\barticles?\b/i, /\binsights?\b/i, /\bresources?\b/i],
    weight: 5,
  },
  {
    type: 'news',
    urlPatterns: [/\/news\b/i, /\/press/i, /\/media\b/i, /\/announcements?\b/i, /\/newsroom/i],
    titlePatterns: [/\bnews\b/i, /\bpress/i, /\bmedia\b/i, /\bnewsroom\b/i, /\bannouncement/i],
    weight: 5,
  },
  {
    type: 'legal',
    urlPatterns: [/\/privacy/i, /\/terms/i, /\/legal\b/i, /\/cookie/i, /\/gdpr/i, /\/disclaimer/i, /\/eula/i],
    titlePatterns: [/\bprivacy\b/i, /\bterms\b/i, /\blegal\b/i, /\bcookie/i, /\bdisclaimer/i],
    weight: 4,
  },
  {
    type: 'faq',
    urlPatterns: [/\/faq/i, /\/help\b/i, /\/support\b/i, /\/knowledge/i],
    titlePatterns: [/\bfaq\b/i, /\bfrequently asked/i, /\bhelp center\b/i],
    weight: 4,
  },
];

/**
 * Classify a page by URL and title. Returns the best-match page type.
 */
export function classifyPage(url: string, title: string): PageType {
  // Detect homepage
  try {
    const parsed = new URL(url);
    if (parsed.pathname === '/' || parsed.pathname === '') {
      return 'home';
    }
  } catch {}

  // Score each rule
  let bestType: PageType = 'other';
  let bestScore = 0;

  for (const rule of RULES) {
    let score = 0;
    for (const pattern of rule.urlPatterns) {
      if (pattern.test(url)) { score += rule.weight * 2; break; }
    }
    for (const pattern of rule.titlePatterns) {
      if (pattern.test(title)) { score += rule.weight; break; }
    }
    if (score > bestScore) {
      bestScore = score;
      bestType = rule.type;
    }
  }

  return bestType;
}

/**
 * Classify all pages and return them grouped by type.
 * High-value types are returned first.
 */
export function classifyPages(pages: Array<{ url: string; title: string }>): Map<PageType, Array<{ url: string; title: string }>> {
  const grouped = new Map<PageType, Array<{ url: string; title: string }>>();

  for (const page of pages) {
    const type = classifyPage(page.url, page.title);
    if (!grouped.has(type)) { grouped.set(type, []); }
    grouped.get(type)!.push(page);
  }

  return grouped;
}

/**
 * Priority order for page types — most intelligence-rich first.
 */
export const PAGE_TYPE_PRIORITY: PageType[] = [
  'about', 'team', 'product', 'service', 'case_study',
  'contact', 'careers', 'pricing', 'partner', 'investor',
  'news', 'blog', 'faq', 'legal', 'home', 'other',
];
