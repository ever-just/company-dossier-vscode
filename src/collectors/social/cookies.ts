// ---------------------------------------------------------------------------
// Browser cookie reader — checks if user has active sessions
//
// Reads cookies from Chrome/Firefox cookie stores on the local machine.
// Used to auto-detect if the user is logged into platforms that require auth
// (Twitter/X, LinkedIn, etc.) without asking them to do anything.
// ---------------------------------------------------------------------------

import { execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

interface CookieResult {
  found: boolean;
  cookieString?: string;
  browser?: string;
  error?: string;
}

const PLATFORM_COOKIES: Record<string, { domain: string; required: string[] }> = {
  twitter: { domain: '.x.com', required: ['auth_token'] },
  instagram: { domain: '.instagram.com', required: ['sessionid'] },
  facebook: { domain: '.facebook.com', required: ['c_user', 'xs'] },
  linkedin: { domain: '.linkedin.com', required: ['li_at'] },
  reddit: { domain: '.reddit.com', required: ['reddit_session'] },
};

/**
 * Get Firefox profile directories.
 */
function getFirefoxProfiles(): string[] {
  const profilesDir = path.join(os.homedir(), 'Library', 'Application Support', 'Firefox', 'Profiles');
  try {
    if (!fs.existsSync(profilesDir)) { return []; }
    return fs.readdirSync(profilesDir)
      .map(d => path.join(profilesDir, d))
      .filter(d => fs.existsSync(path.join(d, 'cookies.sqlite')));
  } catch {
    return [];
  }
}

/**
 * Try to read cookies from Firefox's SQLite cookie store.
 * Firefox cookies are NOT encrypted (unlike Chrome), so we can read them directly.
 */
async function checkFirefox(platform: string): Promise<CookieResult> {
  const config = PLATFORM_COOKIES[platform];
  if (!config) { return { found: false }; }

  const profiles = getFirefoxProfiles();
  if (profiles.length === 0) { return { found: false }; }

  for (const profileDir of profiles) {
    const cookieDb = path.join(profileDir, 'cookies.sqlite');
    try {
      // Use sqlite3 CLI to read cookies (available on macOS)
      const query = `SELECT name, value FROM moz_cookies WHERE host LIKE '%${config.domain}%' AND name IN (${config.required.map(n => `'${n}'`).join(',')});`;

      const output = await new Promise<string>((resolve, reject) => {
        execFile('sqlite3', ['-json', cookieDb, query], { timeout: 5000 }, (err, stdout) => {
          if (err) { reject(err); } else { resolve(stdout); }
        });
      });

      if (output.trim()) {
        const rows = JSON.parse(output);
        const cookies: Record<string, string> = {};
        for (const row of rows) {
          cookies[row.name] = row.value;
        }

        // Check if all required cookies are present
        const hasAll = config.required.every(name => cookies[name]);
        if (hasAll) {
          const cookieString = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
          return { found: true, cookieString, browser: 'Firefox' };
        }
      }
    } catch {}
  }

  return { found: false };
}

/**
 * Try to read cookies from Chrome's cookie store.
 * Chrome cookies ARE encrypted on macOS (via Keychain). We use the `security` CLI
 * to get the decryption key, then sqlite3 to read the DB.
 *
 * This is complex — if it fails, we fall back to asking the user.
 */
async function checkChrome(platform: string): Promise<CookieResult> {
  const config = PLATFORM_COOKIES[platform];
  if (!config) { return { found: false }; }

  // Chrome cookie DB path
  const cookieDb = path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'Cookies');
  if (!fs.existsSync(cookieDb)) { return { found: false }; }

  try {
    // Chrome encrypts cookies on macOS. Reading them requires the Safe Storage key
    // from Keychain. This is possible but complex. For now, we'll try to detect
    // if Chrome has the domain cookies at all (existence check, not decryption).
    const query = `SELECT COUNT(*) as cnt FROM cookies WHERE host_key LIKE '%${config.domain}%' AND name IN (${config.required.map(n => `'${n}'`).join(',')});`;

    const output = await new Promise<string>((resolve, reject) => {
      // Copy DB first (Chrome may have it locked)
      const tmpDb = `/tmp/cd_chrome_cookies_${Date.now()}.db`;
      fs.copyFileSync(cookieDb, tmpDb);

      execFile('sqlite3', ['-json', tmpDb, query], { timeout: 5000 }, (err, stdout) => {
        try { fs.unlinkSync(tmpDb); } catch {}
        if (err) { reject(err); } else { resolve(stdout); }
      });
    });

    if (output.trim()) {
      const rows = JSON.parse(output);
      if (rows[0]?.cnt > 0) {
        // Cookies exist but are encrypted. We know the user HAS a session.
        // For gallery-dl, we can use --cookies-from-browser chrome
        return { found: true, browser: 'Chrome', cookieString: '__chrome_encrypted__' };
      }
    }
  } catch {}

  return { found: false };
}

/**
 * Check if the user has an active session for a platform in any browser.
 * Returns the best available cookie source.
 */
export async function checkBrowserSession(platform: string): Promise<CookieResult> {
  // Try Firefox first (unencrypted cookies = easier to use)
  const firefox = await checkFirefox(platform);
  if (firefox.found) { return firefox; }

  // Try Chrome (encrypted but we can detect presence + use --cookies-from-browser)
  const chrome = await checkChrome(platform);
  if (chrome.found) { return chrome; }

  return { found: false };
}

/**
 * Generate a gallery-dl cookies argument for a platform.
 * Returns the CLI args to pass to gallery-dl, or null if no session found.
 */
export async function getGalleryDlCookieArgs(platform: string): Promise<string[] | null> {
  const session = await checkBrowserSession(platform);
  if (!session.found) { return null; }

  if (session.browser === 'Chrome') {
    // gallery-dl supports --cookies-from-browser chrome
    return ['--cookies-from-browser', 'chrome'];
  }

  if (session.cookieString && session.cookieString !== '__chrome_encrypted__') {
    // Write cookies to temp file in Netscape format
    const config = PLATFORM_COOKIES[platform];
    if (!config) { return null; }

    const tmpFile = `/tmp/cd_cookies_${platform}_${Date.now()}.txt`;
    const pairs = session.cookieString.split('; ');
    const lines = ['# Netscape HTTP Cookie File'];
    for (const pair of pairs) {
      const [name, value] = pair.split('=', 2);
      lines.push(`${config.domain}\tTRUE\t/\tTRUE\t0\t${name}\t${value}`);
    }
    fs.writeFileSync(tmpFile, lines.join('\n'));

    return ['--cookies', tmpFile];
  }

  return null;
}

/**
 * Check which platforms have active browser sessions.
 * Returns a map of platform → { found, browser }.
 */
export async function detectAllSessions(): Promise<Record<string, CookieResult>> {
  const results: Record<string, CookieResult> = {};
  for (const platform of Object.keys(PLATFORM_COOKIES)) {
    results[platform] = await checkBrowserSession(platform);
  }
  return results;
}
