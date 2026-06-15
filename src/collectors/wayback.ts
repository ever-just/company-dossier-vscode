import { fetchJSON, sleep } from '../utils';

export type ProgressCallback = (message: string) => void;

export interface WaybackData {
  domain: string;
  totalCaptures: number;
  firstCapture: string;
  lastCapture: string;
  uniqueUrls: string[];
  pdfUrls: string[];
  pdfWaybackUrls: string[];
  deletedPages: string[];
  contentTypeDistribution: Record<string, number>;
  captureTimeline: Array<{ month: string; count: number }>;
  capturesPerMonth: number;
  siteGrowthSummary: string;
  error?: string;
}

/** Parse CDX timestamp (YYYYMMDDHHmmss) into a YYYY-MM string. */
function timestampToMonth(ts: string): string {
  return ts.slice(0, 4) + '-' + ts.slice(4, 6);
}

/** Format CDX timestamp to readable date. */
function formatTimestamp(ts: string): string {
  if (ts.length < 8) { return ts; }
  return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
}

/** Build a Wayback playback URL from timestamp + original URL. */
function waybackUrl(timestamp: string, originalUrl: string): string {
  return `https://web.archive.org/web/${timestamp}/${originalUrl}`;
}

export async function collectWayback(
  domain: string,
  progressCallback?: ProgressCallback
): Promise<WaybackData> {
  const progress = progressCallback || (() => {});

  const result: WaybackData = {
    domain,
    totalCaptures: 0,
    firstCapture: '',
    lastCapture: '',
    uniqueUrls: [],
    pdfUrls: [],
    pdfWaybackUrls: [],
    deletedPages: [],
    contentTypeDistribution: {},
    captureTimeline: [],
    capturesPerMonth: 0,
    siteGrowthSummary: '',
  };

  // ---- Query 1: All unique URLs (collapse by original) ----
  progress('Wayback: Querying all unique URLs...');
  try {
    const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${domain}/*&output=json&fl=timestamp,original,statuscode,mimetype&collapse=original&limit=2000`;
    const data = await fetchJSON(cdxUrl, 30000);

    if (!Array.isArray(data) || data.length < 2) {
      result.error = 'No Wayback data found';
      return result;
    }

    const rows = data.slice(1); // Skip header
    result.totalCaptures = rows.length;

    // Timestamps for first/last
    const timestamps = rows.map((r: any) => r[0]).sort();
    result.firstCapture = formatTimestamp(timestamps[0] || '');
    result.lastCapture = formatTimestamp(timestamps[timestamps.length - 1] || '');

    // Unique URLs
    const urlSet = new Set<string>();
    for (const row of rows) { urlSet.add(row[1]); }
    result.uniqueUrls = [...urlSet].slice(0, 500);

    // Content type distribution from this first query
    const mimeCount: Record<string, number> = {};
    for (const row of rows) {
      const mime = (row[3] || 'unknown').split(';')[0].trim().toLowerCase();
      const category = mime.includes('html') ? 'HTML'
        : mime.includes('pdf') ? 'PDF'
        : mime.includes('image') ? 'Image'
        : mime.includes('javascript') || mime.includes('ecmascript') ? 'JavaScript'
        : mime.includes('css') ? 'CSS'
        : mime.includes('json') ? 'JSON'
        : mime.includes('xml') ? 'XML'
        : 'Other';
      mimeCount[category] = (mimeCount[category] || 0) + 1;
    }
    result.contentTypeDistribution = mimeCount;

    // Deleted pages: had status 200 earlier, last status is not 200
    const urlStatusMap = new Map<string, { statuses: string[]; timestamps: string[] }>();
    for (const row of rows) {
      const url = row[1];
      const status = row[2];
      const ts = row[0];
      if (!urlStatusMap.has(url)) { urlStatusMap.set(url, { statuses: [], timestamps: [] }); }
      urlStatusMap.get(url)!.statuses.push(status);
      urlStatusMap.get(url)!.timestamps.push(ts);
    }
    for (const [url, info] of urlStatusMap) {
      if (info.statuses.includes('200') && info.statuses[info.statuses.length - 1] !== '200') {
        result.deletedPages.push(url);
      }
    }

    progress(`Wayback Q1: ${result.uniqueUrls.length} unique URLs, first: ${result.firstCapture}, last: ${result.lastCapture}`);
  } catch (err: any) {
    result.error = 'CDX query 1 failed: ' + err.message;
    return result;
  }

  await sleep(2000);

  // ---- Query 2: PDFs specifically ----
  progress('Wayback: Querying PDFs...');
  try {
    const pdfCdxUrl = `https://web.archive.org/cdx/search/cdx?url=${domain}/*&output=json&fl=timestamp,original,statuscode,mimetype&mimetype=application/pdf&limit=500`;
    const pdfData = await fetchJSON(pdfCdxUrl, 20000);

    if (Array.isArray(pdfData) && pdfData.length > 1) {
      const pdfRows = pdfData.slice(1);
      // Deduplicate by original URL
      const pdfOriginals = new Map<string, string>(); // original -> latest timestamp
      for (const row of pdfRows) {
        const orig = row[1];
        const ts = row[0];
        if (!pdfOriginals.has(orig) || ts > pdfOriginals.get(orig)!) {
          pdfOriginals.set(orig, ts);
        }
      }

      result.pdfUrls = [...pdfOriginals.keys()];

      // Build Wayback playback URLs for up to 10 PDFs
      const pdfEntries = [...pdfOriginals.entries()].slice(0, 10);
      result.pdfWaybackUrls = pdfEntries.map(([orig, ts]) => waybackUrl(ts, orig));

      progress(`Wayback Q2: ${result.pdfUrls.length} unique PDFs found. ${result.pdfWaybackUrls.length} playback URLs saved.`);
    } else {
      progress('Wayback Q2: No PDFs found.');
    }
  } catch (err: any) {
    progress('Wayback Q2 failed: ' + err.message);
    // Non-fatal: continue
  }

  await sleep(2000);

  // ---- Query 3: Capture timeline (collapse by month) ----
  progress('Wayback: Querying capture timeline...');
  try {
    const timelineCdxUrl = `https://web.archive.org/cdx/search/cdx?url=${domain}/*&output=json&fl=timestamp&collapse=timestamp:6&limit=5000`;
    const timelineData = await fetchJSON(timelineCdxUrl, 20000);

    if (Array.isArray(timelineData) && timelineData.length > 1) {
      const timelineRows = timelineData.slice(1);

      // Count captures per month
      const monthCounts = new Map<string, number>();
      for (const row of timelineRows) {
        const month = timestampToMonth(row[0]);
        monthCounts.set(month, (monthCounts.get(month) || 0) + 1);
      }

      // Sort by month
      const sortedMonths = [...monthCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      result.captureTimeline = sortedMonths.map(([month, count]) => ({ month, count }));

      // Calculate average captures per month
      if (sortedMonths.length > 0) {
        const totalMonthCaptures = sortedMonths.reduce((sum, [, c]) => sum + c, 0);
        result.capturesPerMonth = Math.round((totalMonthCaptures / sortedMonths.length) * 10) / 10;
      }

      // Growth summary
      if (sortedMonths.length >= 2) {
        const firstYear = sortedMonths[0][0].slice(0, 4);
        const lastYear = sortedMonths[sortedMonths.length - 1][0].slice(0, 4);
        const yearSpan = parseInt(lastYear) - parseInt(firstYear) + 1;
        // Compare first-half vs second-half capture rates
        const mid = Math.floor(sortedMonths.length / 2);
        const firstHalfAvg = sortedMonths.slice(0, mid).reduce((s, [, c]) => s + c, 0) / mid;
        const secondHalfAvg = sortedMonths.slice(mid).reduce((s, [, c]) => s + c, 0) / (sortedMonths.length - mid);
        const growthPct = firstHalfAvg > 0 ? Math.round(((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100) : 0;
        result.siteGrowthSummary = `${yearSpan} years of captures (${firstYear}-${lastYear}). ${timelineRows.length} total timeline entries across ${sortedMonths.length} months. Avg ${result.capturesPerMonth} captures/month. Second-half activity ${growthPct >= 0 ? '+' : ''}${growthPct}% vs first-half.`;
      }

      progress(`Wayback Q3: ${result.captureTimeline.length} months of activity. ${result.siteGrowthSummary}`);
    } else {
      progress('Wayback Q3: No timeline data.');
    }
  } catch (err: any) {
    progress('Wayback Q3 failed: ' + err.message);
    // Non-fatal
  }

  progress(`Wayback complete: ${result.totalCaptures} captures, ${result.pdfUrls.length} PDFs, ${result.deletedPages.length} deleted pages, ${result.captureTimeline.length} months tracked.`);

  return result;
}
