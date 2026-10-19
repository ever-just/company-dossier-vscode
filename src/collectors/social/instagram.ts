// ---------------------------------------------------------------------------
// Instagram adapter — pulls public profile + posts via instagrapi (Python)
// ---------------------------------------------------------------------------

import { execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { mkdirp, slugify, sleep } from '../../utils';

export interface InstagramProfile {
  username: string;
  fullName: string;
  biography: string;
  followerCount: number;
  followingCount: number;
  mediaCount: number;
  externalUrl: string;
  isBusinessAccount: boolean;
  category: string;
  profilePicUrl: string;
}

export interface InstagramPost {
  id: string;
  mediaType: number; // 1=photo, 2=video, 8=album
  captionText: string;
  likeCount: number;
  commentCount: number;
  timestamp: string;
  mediaUrl: string;
  thumbnailUrl: string;
  videoUrl?: string;
  location?: string;
  hashtags: string[];
  taggedUsers: string[];
}

export interface InstagramResult {
  profile: InstagramProfile | null;
  posts: InstagramPost[];
  error?: string;
}

/**
 * Run a Python snippet via subprocess and return JSON output.
 */
function runPython(code: string, timeoutMs = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    // Try python3.13 first (where instagrapi is installed), then python3
    const pythons = ['python3.13', 'python3', 'python'];
    let idx = 0;

    function tryNext(): void {
      if (idx >= pythons.length) {
        reject(new Error('Python not found or instagrapi not installed'));
        return;
      }
      const py = pythons[idx++];
      const proc = execFile(py, ['-c', code], { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          if (idx < pythons.length && (err.message.includes('ENOENT') || err.message.includes('No module'))) {
            tryNext();
          } else {
            reject(new Error(stderr || err.message));
          }
        } else {
          resolve(stdout);
        }
      });
    }
    tryNext();
  });
}

/**
 * Pull public Instagram profile + recent posts.
 * Uses instagrapi's public endpoints — no login needed for public profiles.
 */
export async function pullInstagram(
  handle: string,
  maxPosts: number,
  outputDir: string,
  downloadMedia: boolean,
  progress: (msg: string) => void
): Promise<InstagramResult> {
  // Clean handle
  handle = handle.replace(/^@/, '').replace(/\/$/, '');
  progress(`Instagram: fetching @${handle}...`);

  const code = `
import json, sys
try:
    from instagrapi import Client
except ImportError:
    print(json.dumps({"error": "instagrapi not installed. Run: pip install instagrapi"}))
    sys.exit(0)

cl = Client()
result = {"profile": None, "posts": [], "error": None}

try:
    info = cl.user_info_by_username("${handle}")
    result["profile"] = {
        "username": info.username,
        "fullName": info.full_name,
        "biography": info.biography or "",
        "followerCount": info.follower_count,
        "followingCount": info.following_count,
        "mediaCount": info.media_count,
        "externalUrl": str(info.external_url or ""),
        "isBusinessAccount": info.is_business,
        "category": info.category or "",
        "profilePicUrl": str(info.profile_pic_url_hd or info.profile_pic_url or ""),
    }

    medias = cl.user_medias(info.pk, amount=${maxPosts})
    for m in medias:
        post = {
            "id": m.pk,
            "mediaType": m.media_type,
            "captionText": m.caption_text or "",
            "likeCount": m.like_count or 0,
            "commentCount": m.comment_count or 0,
            "timestamp": str(m.taken_at) if m.taken_at else "",
            "mediaUrl": str(m.thumbnail_url or ""),
            "thumbnailUrl": str(m.thumbnail_url or ""),
            "videoUrl": str(m.video_url or "") if m.video_url else None,
            "location": m.location.name if m.location else None,
            "hashtags": [t.name for t in (m.usertags or [])],
            "taggedUsers": [t.user.username for t in (m.usertags or [])],
        }
        result["posts"].append(post)
except Exception as e:
    result["error"] = str(e)

print(json.dumps(result, default=str))
`;

  try {
    const output = await runPython(code, 60000);
    const data = JSON.parse(output.trim());

    if (data.error) {
      progress(`Instagram: ${data.error}`);
      return { profile: null, posts: [], error: data.error };
    }

    const profile: InstagramProfile = data.profile;
    const posts: InstagramPost[] = data.posts || [];

    progress(`Instagram: @${handle} — ${profile.followerCount.toLocaleString()} followers, ${posts.length} posts fetched`);

    // Write profile JSON
    const igDir = path.join(outputDir, 'instagram');
    mkdirp(igDir);
    fs.writeFileSync(path.join(igDir, 'profile.json'), JSON.stringify(profile, null, 2));

    // Download media if enabled
    if (downloadMedia && posts.length > 0) {
      const postsDir = path.join(igDir, 'posts');
      mkdirp(postsDir);

      let downloaded = 0;
      for (const post of posts) {
        const dateStr = post.timestamp ? post.timestamp.split(' ')[0] : 'undated';
        const caption = (post.captionText || '').slice(0, 40).replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '-') || 'post';
        const baseName = `${dateStr}_${caption}`;

        // Write metadata sidecar
        fs.writeFileSync(
          path.join(postsDir, `${baseName}.json`),
          JSON.stringify(post, null, 2)
        );

        // Download image/video
        const mediaUrl = post.videoUrl || post.mediaUrl;
        if (mediaUrl) {
          try {
            const ext = post.videoUrl ? '.mp4' : '.jpg';
            const resp = await fetch(mediaUrl, {
              headers: { 'User-Agent': 'CompanyDossier/2.0' },
            });
            if (resp.ok) {
              const buffer = Buffer.from(await resp.arrayBuffer());
              fs.writeFileSync(path.join(postsDir, `${baseName}${ext}`), buffer);
              downloaded++;
            }
          } catch {}
        }

        // Rate limit
        if (downloaded % 5 === 0 && downloaded > 0) {
          progress(`Instagram: downloaded ${downloaded}/${posts.length} media files`);
          await sleep(500);
        }
      }

      progress(`Instagram: ${downloaded} media files downloaded`);
    }

    return { profile, posts };

  } catch (err: any) {
    const msg = err.message || String(err);
    progress(`Instagram: failed — ${msg}`);
    return { profile: null, posts: [], error: msg };
  }
}
