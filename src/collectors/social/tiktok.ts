// ---------------------------------------------------------------------------
// TikTok adapter — pulls video list + metadata via gallery-dl
// ---------------------------------------------------------------------------

import { execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { mkdirp } from '../../utils';

export interface TikTokVideo {
  url: string;
  description: string;
}

export interface TikTokResult {
  handle: string;
  videos: TikTokVideo[];
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
 * Pull TikTok profile videos via gallery-dl.
 * No auth needed for public profiles.
 */
export async function pullTikTok(
  handle: string,
  maxVideos: number,
  outputDir: string,
  downloadMedia: boolean,
  progress: (msg: string) => void
): Promise<TikTokResult> {
  handle = handle.replace(/^@/, '');
  const profileUrl = `https://www.tiktok.com/@${handle}`;
  progress(`TikTok: fetching @${handle}...`);

  try {
    const ttDir = path.join(outputDir, 'tiktok');
    mkdirp(ttDir);

    if (downloadMedia) {
      // Download videos to folder
      const videosDir = path.join(ttDir, 'videos');
      mkdirp(videosDir);

      const args = [
        '--range', `1-${maxVideos}`,
        '--directory', videosDir,
        '--filename', '{date:%Y-%m-%d}_{id}.{extension}',
        '--write-metadata',
        profileUrl,
      ];

      await runCommand('gallery-dl', args, 120000);

      // Count downloaded files
      const files = fs.existsSync(videosDir) ? fs.readdirSync(videosDir) : [];
      const videoFiles = files.filter(f => f.endsWith('.mp4'));
      progress(`TikTok: @${handle} — ${videoFiles.length} videos downloaded`);

      return { handle, videos: videoFiles.map(f => ({ url: f, description: '' })) };
    } else {
      // URL-only mode (fast)
      const args = [
        '--range', `1-${maxVideos}`,
        '-G', // Print URLs only
        profileUrl,
      ];

      const output = await runCommand('gallery-dl', args, 60000);
      const urls = output.trim().split('\n').filter(u => u.startsWith('http'));
      progress(`TikTok: @${handle} — ${urls.length} video URLs found`);

      // Write URL list
      fs.writeFileSync(path.join(ttDir, 'video_urls.json'), JSON.stringify({
        handle,
        videoCount: urls.length,
        urls,
      }, null, 2));

      return { handle, videos: urls.map(u => ({ url: u, description: '' })) };
    }

  } catch (err: any) {
    const msg = err.message || String(err);
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      progress('TikTok: gallery-dl not installed — skipping');
      return { handle, videos: [], error: 'gallery-dl not installed' };
    }
    progress(`TikTok: failed — ${msg.slice(0, 100)}`);
    return { handle, videos: [], error: msg };
  }
}
