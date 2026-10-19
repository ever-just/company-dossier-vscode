// ---------------------------------------------------------------------------
// YouTube adapter — pulls channel metadata + video list via yt-dlp
// ---------------------------------------------------------------------------

import { execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { mkdirp } from '../../utils';

export interface YouTubeVideo {
  id: string;
  title: string;
  description: string;
  viewCount: number;
  likeCount: number;
  duration: number;
  uploadDate: string;
  url: string;
  thumbnailUrl: string;
}

export interface YouTubeResult {
  channelName: string;
  channelUrl: string;
  videos: YouTubeVideo[];
  totalVideos: number;
  error?: string;
}

function runCommand(cmd: string, args: string[], timeoutMs = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) { reject(new Error(stderr || err.message)); }
      else { resolve(stdout); }
    });
  });
}

/**
 * Pull YouTube channel video list + metadata via yt-dlp.
 * No auth needed for public channels.
 */
export async function pullYouTube(
  channelUrl: string,
  maxVideos: number,
  outputDir: string,
  downloadThumbnails: boolean,
  progress: (msg: string) => void
): Promise<YouTubeResult> {
  progress(`YouTube: fetching channel...`);

  // Normalize URL
  if (!channelUrl.includes('youtube.com') && !channelUrl.includes('youtu.be')) {
    channelUrl = `https://www.youtube.com/@${channelUrl.replace(/^@/, '')}`;
  }
  const videosUrl = channelUrl.replace(/\/$/, '') + '/videos';

  try {
    // Get video list as JSON
    const args = [
      '--flat-playlist',
      '--print-json',
      '--playlist-items', `1-${maxVideos}`,
      '--no-warnings',
      videosUrl,
    ];

    const output = await runCommand('yt-dlp', args, 60000);
    const lines = output.trim().split('\n').filter(Boolean);

    const videos: YouTubeVideo[] = [];
    let channelName = '';

    for (const line of lines) {
      try {
        const data = JSON.parse(line);
        channelName = channelName || data.channel || data.uploader || '';
        videos.push({
          id: data.id || '',
          title: data.title || '',
          description: (data.description || '').slice(0, 500),
          viewCount: data.view_count || 0,
          likeCount: data.like_count || 0,
          duration: data.duration || 0,
          uploadDate: data.upload_date || '',
          url: data.webpage_url || data.url || '',
          thumbnailUrl: data.thumbnail || '',
        });
      } catch {}
    }

    progress(`YouTube: ${channelName} — ${videos.length} videos found`);

    // Write output
    const ytDir = path.join(outputDir, 'youtube');
    mkdirp(ytDir);

    fs.writeFileSync(path.join(ytDir, 'videos.json'), JSON.stringify({
      channelName,
      channelUrl,
      videoCount: videos.length,
      videos,
    }, null, 2));

    // Download thumbnails
    if (downloadThumbnails && videos.length > 0) {
      const thumbDir = path.join(ytDir, 'thumbnails');
      mkdirp(thumbDir);

      let downloaded = 0;
      for (const video of videos.slice(0, maxVideos)) {
        if (video.thumbnailUrl) {
          try {
            const resp = await fetch(video.thumbnailUrl, {
              headers: { 'User-Agent': 'CompanyDossier/2.0' },
            });
            if (resp.ok) {
              const buffer = Buffer.from(await resp.arrayBuffer());
              fs.writeFileSync(path.join(thumbDir, `${video.id}.jpg`), buffer);
              downloaded++;
            }
          } catch {}
        }
      }
      progress(`YouTube: ${downloaded} thumbnails downloaded`);
    }

    return {
      channelName,
      channelUrl,
      videos,
      totalVideos: videos.length,
    };

  } catch (err: any) {
    const msg = err.message || String(err);
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      progress('YouTube: yt-dlp not installed — skipping');
      return { channelName: '', channelUrl, videos: [], totalVideos: 0, error: 'yt-dlp not installed' };
    }
    progress(`YouTube: failed — ${msg.slice(0, 100)}`);
    return { channelName: '', channelUrl, videos: [], totalVideos: 0, error: msg };
  }
}
