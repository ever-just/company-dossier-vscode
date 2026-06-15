import { fetchJSON, sleep } from '../utils';

export interface WaybackData {
  domain: string;
  totalCaptures: number;
  firstCapture: string;
  lastCapture: string;
  uniqueUrls: string[];
  pdfUrls: string[];
  deletedPages: string[];
  error?: string;
}

export async function collectWayback(domain: string): Promise<WaybackData> {
  const result: WaybackData = {
    domain, totalCaptures: 0, firstCapture: '', lastCapture: '',
    uniqueUrls: [], pdfUrls: [], deletedPages: []
  };

  try {
    const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${domain}/*&output=json&fl=timestamp,original,statuscode,mimetype&collapse=original&limit=500`;
    const data = await fetchJSON(cdxUrl, 20000);

    if (!Array.isArray(data) || data.length < 2) {
      result.error = 'No Wayback data found';
      return result;
    }

    // Skip header row
    const rows = data.slice(1);
    result.totalCaptures = rows.length;

    // Timestamps
    const timestamps = rows.map((r: any) => r[0]).sort();
    result.firstCapture = timestamps[0] || '';
    result.lastCapture = timestamps[timestamps.length - 1] || '';

    // Unique URLs
    const urlSet = new Set<string>();
    for (const row of rows) {
      urlSet.add(row[1]);
    }
    result.uniqueUrls = [...urlSet].slice(0, 200);

    // PDF URLs
    result.pdfUrls = rows
      .filter((r: any) => r[3] && r[3].includes('pdf'))
      .map((r: any) => r[1]);

    // Deleted pages (status 404 in most recent capture but 200 earlier)
    const urlStatus = new Map<string, string[]>();
    for (const row of rows) {
      const url = row[1];
      const status = row[2];
      if (!urlStatus.has(url)) { urlStatus.set(url, []); }
      urlStatus.get(url)!.push(status);
    }
    for (const [url, statuses] of urlStatus) {
      if (statuses.includes('200') && statuses[statuses.length - 1] !== '200') {
        result.deletedPages.push(url);
      }
    }

    await sleep(1500); // Rate limit

  } catch (err: any) {
    result.error = err.message;
  }

  return result;
}
