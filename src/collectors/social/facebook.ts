// ---------------------------------------------------------------------------
// Facebook adapter — pulls photos from public pages via gallery-dl
// ---------------------------------------------------------------------------

import { execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { mkdirp } from '../../utils';

export interface FacebookResult {
  pageName: string;
  photoCount: number;
  error?: string;
}

function runCommand(cmd: string, args: string[], timeoutMs = 60000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) { reject(new Error(stderr || err.message)); }
      else { resolve(stdout); }
    });
  });
}

/**
 * Pull Facebook page photos via gallery-dl.
 * No auth needed for public page photos.
 */
export async function pullFacebook(
  pageUrl: string,
  maxPhotos: number,
  outputDir: string,
  downloadMedia: boolean,
  progress: (msg: string) => void
): Promise<FacebookResult> {
  // Normalize to photos URL
  const photosUrl = pageUrl.replace(/\/$/, '') + '/photos';
  const pageName = pageUrl.split('facebook.com/')[1]?.replace(/\/$/, '') || 'unknown';
  progress(`Facebook: fetching ${pageName} photos...`);

  try {
    const fbDir = path.join(outputDir, 'facebook');
    mkdirp(fbDir);

    if (downloadMedia) {
      const photosDir = path.join(fbDir, 'photos');
      mkdirp(photosDir);

      const args = [
        '--range', `1-${maxPhotos}`,
        '--directory', photosDir,
        '--filename', '{num:03d}.{extension}',
        photosUrl,
      ];

      await runCommand('gallery-dl', args, 90000);

      const files = fs.existsSync(photosDir) ? fs.readdirSync(photosDir).filter(f => /\.(jpg|png|webp)$/i.test(f)) : [];
      progress(`Facebook: ${files.length} photos downloaded`);

      return { pageName, photoCount: files.length };
    } else {
      // URL-only mode
      const args = [
        '--range', `1-${maxPhotos}`,
        '-G',
        photosUrl,
      ];

      const output = await runCommand('gallery-dl', args, 60000);
      const urls = output.trim().split('\n').filter(u => u.startsWith('http'));

      fs.writeFileSync(path.join(fbDir, 'photo_urls.json'), JSON.stringify({
        pageName,
        photoCount: urls.length,
        urls,
      }, null, 2));

      progress(`Facebook: ${urls.length} photo URLs found`);
      return { pageName, photoCount: urls.length };
    }

  } catch (err: any) {
    const msg = err.message || String(err);
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      progress('Facebook: gallery-dl not installed — skipping');
      return { pageName, photoCount: 0, error: 'gallery-dl not installed' };
    }
    progress(`Facebook: failed — ${msg.slice(0, 100)}`);
    return { pageName, photoCount: 0, error: msg };
  }
}
