import * as fs from 'fs';
import * as path from 'path';

export function mkdirp(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function writeFile(filePath: string, content: string): void {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

export function writeIfNotExists(filePath: string, content: string): boolean {
  mkdirp(path.dirname(filePath));
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  }
  return false;
}

export function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '').replace(/^_+/, '');
}

export function titleCase(str: string): string {
  return str.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export async function fetchText(url: string, timeoutMs = 10000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // Browser-like headers get past many lightweight bot filters that 403
        // a generic agent string. Sites with real anti-bot (RentCafe/Yardi,
        // Cloudflare challenges) still block this — those are covered by the
        // LLM's web_search fallback in llm.ts.
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });
    if (!resp.ok) { throw new Error(`HTTP ${resp.status}`); }
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJSON(url: string, timeoutMs = 15000): Promise<any> {
  const text = await fetchText(url, timeoutMs);
  return JSON.parse(text);
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
