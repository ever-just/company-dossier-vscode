// ---------------------------------------------------------------------------
// Social content orchestrator — pulls content from all discovered profiles
//
// This is the main entry point. It takes discovered social profiles (URLs),
// figures out which platforms to pull from, checks auth status, and dispatches
// to platform-specific adapters.
// ---------------------------------------------------------------------------

import * as path from 'path';
import { mkdirp } from '../utils';
import { pullInstagram, InstagramResult } from './social/instagram';
import { pullYouTube, YouTubeResult } from './social/youtube';
import { pullTikTok, TikTokResult } from './social/tiktok';
import { pullFacebook, FacebookResult } from './social/facebook';
import { checkBrowserSession } from './social/cookies';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlatformStatus = 'pulling' | 'done' | 'skipped' | 'needs_auth' | 'error' | 'not_installed';

export interface SocialProfileStatus {
  platform: string;
  handle: string;
  url: string;
  status: PlatformStatus;
  itemCount: number;
  detail: string;
}

export interface SocialPullResult {
  profiles: SocialProfileStatus[];
  instagram?: InstagramResult;
  youtube?: YouTubeResult;
  tiktok?: TikTokResult;
  facebook?: FacebookResult;
  totalItems: number;
  errors: string[];
}

export interface SocialPullOptions {
  maxPostsPerPlatform: number;
  downloadMedia: boolean;
  enabledPlatforms: string[];
}

// ---------------------------------------------------------------------------
// URL → Platform mapping
// ---------------------------------------------------------------------------

interface ParsedProfile {
  platform: string;
  handle: string;
  url: string;
}

function parseProfileUrl(url: string): ParsedProfile | null {
  const u = url.toLowerCase();

  if (u.includes('instagram.com')) {
    const match = url.match(/instagram\.com\/([^/?#]+)/i);
    return match ? { platform: 'instagram', handle: match[1], url } : null;
  }
  if (u.includes('youtube.com') || u.includes('youtu.be')) {
    const match = url.match(/youtube\.com\/(?:@|channel\/|c\/|user\/)([^/?#]+)/i);
    return match ? { platform: 'youtube', handle: match[1], url } : null;
  }
  if (u.includes('tiktok.com')) {
    const match = url.match(/tiktok\.com\/@([^/?#]+)/i);
    return match ? { platform: 'tiktok', handle: match[1], url } : null;
  }
  if (u.includes('facebook.com')) {
    const match = url.match(/facebook\.com\/([^/?#]+)/i);
    if (match && !['sharer', 'share', 'login', 'help', 'groups'].includes(match[1].toLowerCase())) {
      return { platform: 'facebook', handle: match[1], url };
    }
  }
  if (u.includes('twitter.com') || u.includes('x.com')) {
    const match = url.match(/(?:twitter|x)\.com\/([^/?#]+)/i);
    if (match && !['share', 'intent', 'search', 'home', 'login'].includes(match[1].toLowerCase())) {
      return { platform: 'twitter', handle: match[1], url };
    }
  }
  if (u.includes('linkedin.com/company')) {
    const match = url.match(/linkedin\.com\/company\/([^/?#]+)/i);
    return match ? { platform: 'linkedin', handle: match[1], url } : null;
  }
  if (u.includes('pinterest.com')) {
    const match = url.match(/pinterest\.com\/([^/?#]+)/i);
    return match ? { platform: 'pinterest', handle: match[1], url } : null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Platforms that need auth vs don't
// ---------------------------------------------------------------------------

const NO_AUTH_PLATFORMS = new Set(['instagram', 'tiktok', 'youtube', 'facebook', 'pinterest', 'tumblr', 'flickr']);
const AUTH_PLATFORMS = new Set(['twitter', 'linkedin', 'reddit']);

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Pull social media content from discovered profile URLs.
 *
 * @param profileUrls - Social profile URLs discovered during website crawl
 * @param outputDir - Base output directory (e.g., dossier/8_marketing/social_content)
 * @param options - Pull configuration
 * @param progress - Status callback
 * @param onStatus - Live status callback for sidebar UI
 */
export async function pullSocialContent(
  profileUrls: string[],
  outputDir: string,
  options: SocialPullOptions,
  progress: (msg: string) => void,
  onStatus?: (statuses: SocialProfileStatus[]) => void
): Promise<SocialPullResult> {
  // Parse URLs into platform profiles
  const profiles: ParsedProfile[] = [];
  const seen = new Set<string>();
  for (const url of profileUrls) {
    const parsed = parseProfileUrl(url);
    if (parsed && !seen.has(parsed.platform) && options.enabledPlatforms.includes(parsed.platform)) {
      seen.add(parsed.platform);
      profiles.push(parsed);
    }
  }

  if (profiles.length === 0) {
    progress('Social: no supported profiles found');
    return { profiles: [], totalItems: 0, errors: [] };
  }

  progress(`Social: ${profiles.length} profiles to pull — ${profiles.map(p => p.platform).join(', ')}`);

  // Initialize status tracking
  const statuses: SocialProfileStatus[] = profiles.map(p => ({
    platform: p.platform,
    handle: p.handle,
    url: p.url,
    status: 'pulling' as PlatformStatus,
    itemCount: 0,
    detail: 'Starting...',
  }));
  const emit = () => { if (onStatus) { onStatus([...statuses]); } };
  emit();

  mkdirp(outputDir);
  const result: SocialPullResult = { profiles: statuses, totalItems: 0, errors: [] };

  // Process each platform
  for (const profile of profiles) {
    const statusIdx = statuses.findIndex(s => s.platform === profile.platform);
    const updateStatus = (status: PlatformStatus, detail: string, count?: number) => {
      if (statusIdx >= 0) {
        statuses[statusIdx].status = status;
        statuses[statusIdx].detail = detail;
        if (count !== undefined) { statuses[statusIdx].itemCount = count; }
        emit();
      }
    };

    try {
      // Check if auth is needed
      if (AUTH_PLATFORMS.has(profile.platform)) {
        const session = await checkBrowserSession(profile.platform);
        if (!session.found) {
          updateStatus('needs_auth', 'Sign in to pull');
          progress(`Social: ${profile.platform} needs auth — skipping`);
          continue;
        }
        updateStatus('pulling', `Connected via ${session.browser}`);
      }

      // Dispatch to platform adapter
      switch (profile.platform) {
        case 'instagram': {
          updateStatus('pulling', 'Fetching profile...');
          const igResult = await pullInstagram(
            profile.handle,
            options.maxPostsPerPlatform,
            outputDir,
            options.downloadMedia,
            progress
          );
          result.instagram = igResult;
          if (igResult.error) {
            updateStatus('error', igResult.error.slice(0, 50));
            result.errors.push(`Instagram: ${igResult.error}`);
          } else {
            const count = igResult.posts.length;
            updateStatus('done', `${count} posts`, count);
            result.totalItems += count;
          }
          break;
        }

        case 'youtube': {
          updateStatus('pulling', 'Fetching videos...');
          const ytResult = await pullYouTube(
            profile.url,
            options.maxPostsPerPlatform,
            outputDir,
            options.downloadMedia,
            progress
          );
          result.youtube = ytResult;
          if (ytResult.error) {
            updateStatus(ytResult.error.includes('not installed') ? 'not_installed' : 'error', ytResult.error.slice(0, 50));
            result.errors.push(`YouTube: ${ytResult.error}`);
          } else {
            updateStatus('done', `${ytResult.totalVideos} videos`, ytResult.totalVideos);
            result.totalItems += ytResult.totalVideos;
          }
          break;
        }

        case 'tiktok': {
          updateStatus('pulling', 'Fetching videos...');
          const ttResult = await pullTikTok(
            profile.handle,
            options.maxPostsPerPlatform,
            outputDir,
            options.downloadMedia,
            progress
          );
          result.tiktok = ttResult;
          if (ttResult.error) {
            updateStatus(ttResult.error.includes('not installed') ? 'not_installed' : 'error', ttResult.error.slice(0, 50));
            result.errors.push(`TikTok: ${ttResult.error}`);
          } else {
            const count = ttResult.videos.length;
            updateStatus('done', `${count} videos`, count);
            result.totalItems += count;
          }
          break;
        }

        case 'facebook': {
          updateStatus('pulling', 'Fetching photos...');
          const fbResult = await pullFacebook(
            profile.url,
            options.maxPostsPerPlatform,
            outputDir,
            options.downloadMedia,
            progress
          );
          result.facebook = fbResult;
          if (fbResult.error) {
            updateStatus(fbResult.error.includes('not installed') ? 'not_installed' : 'error', fbResult.error.slice(0, 50));
            result.errors.push(`Facebook: ${fbResult.error}`);
          } else {
            updateStatus('done', `${fbResult.photoCount} photos`, fbResult.photoCount);
            result.totalItems += fbResult.photoCount;
          }
          break;
        }

        case 'twitter':
        case 'linkedin':
        case 'pinterest':
          updateStatus('skipped', 'Coming soon');
          break;
        default:
          updateStatus('skipped', 'Not supported');
          break;
      }

    } catch (err: any) {
      updateStatus('error', err.message?.slice(0, 50) || 'Unknown error');
      result.errors.push(`${profile.platform}: ${err.message}`);
    }
  }

  progress(`Social: done — ${result.totalItems} total items across ${profiles.length} platforms`);
  return result;
}
