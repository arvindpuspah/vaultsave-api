// VaultSave Universal Downloader API
// Supports: Instagram, YouTube Shorts, Facebook, Pinterest, Twitter/X, TikTok
// Deploy on Vercel — free tier works perfectly

const https = require('https');
const http = require('http');
const { URL } = require('url');

// ── CORS HEADERS ──────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  'Content-Type': 'application/json',
};

// ── HELPERS ───────────────────────────────────────────────────────────────────
function fetchUrl(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: opts.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
        ...(opts.headers || {}),
      },
      timeout: 15000,
    };
    const req = lib.request(options, (res) => {
      // Follow redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        return fetchUrl(res.headers.location, opts).then(resolve).catch(reject);
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function parseJson(str) {
  try { return JSON.parse(str); } catch { return null; }
}

function detectPlatform(url) {
  if (/instagram\.com/i.test(url)) return 'instagram';
  if (/youtube\.com\/shorts|youtu\.be/i.test(url)) return 'youtube';
  if (/facebook\.com|fb\.watch/i.test(url)) return 'facebook';
  if (/pinterest\.com|pin\.it/i.test(url)) return 'pinterest';
  if (/twitter\.com|x\.com/i.test(url)) return 'twitter';
  if (/tiktok\.com/i.test(url)) return 'tiktok';
  return 'unknown';
}

// ── INSTAGRAM HANDLER ─────────────────────────────────────────────────────────
async function handleInstagram(url) {
  // Method 1: SnapInsta API (most reliable free)
  try {
    const payload = 'url=' + encodeURIComponent(url);
    const res = await fetchUrl('https://snapinsta.app/action.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://snapinsta.app',
        'Referer': 'https://snapinsta.app/',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: payload,
    });
    const json = parseJson(res.body);
    if (json && json.url) {
      return {
        platform: 'instagram',
        type: json.type || 'video',
        medias: [{ url: json.url, quality: 'HD', ext: json.type === 'image' ? 'jpg' : 'mp4' }],
        thumbnail: json.thumbnail || null,
      };
    }
  } catch {}

  // Method 2: Scrape Instagram OEmbed
  try {
    const oembedUrl = 'https://www.instagram.com/oembed/?url=' + encodeURIComponent(url);
    const res = await fetchUrl(oembedUrl, {
      headers: { 'Accept': 'application/json' }
    });
    const json = parseJson(res.body);
    if (json && json.thumbnail_url) {
      return {
        platform: 'instagram',
        type: 'image',
        medias: [{ url: json.thumbnail_url, quality: 'Thumbnail', ext: 'jpg' }],
        thumbnail: json.thumbnail_url,
        title: json.title || '',
        note: 'Only thumbnail available — post may require login for video',
      };
    }
  } catch {}

  // Method 3: SSInstagram API
  try {
    const payload = 'q=' + encodeURIComponent(url) + '&t=media&lang=en';
    const res = await fetchUrl('https://v3.sssinstagram.com/s', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://sssinstagram.com',
        'Referer': 'https://sssinstagram.com/',
      },
      body: payload,
    });
    const json = parseJson(res.body);
    if (json && json.data && Array.isArray(json.data)) {
      const medias = json.data
        .filter(m => m.url)
        .map(m => ({ url: m.url, quality: m.quality || 'HD', ext: m.extension || 'mp4' }));
      if (medias.length) {
        return { platform: 'instagram', type: 'video', medias, thumbnail: json.thumbnail || null };
      }
    }
  } catch {}

  return null;
}

// ── YOUTUBE SHORTS HANDLER ────────────────────────────────────────────────────
async function handleYoutube(url) {
  // Extract video ID
  let videoId = null;
  const shortMatch = url.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/);
  const normalMatch = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (shortMatch) videoId = shortMatch[1];
  else if (normalMatch) videoId = normalMatch[1];
  if (!videoId) return null;

  // Method 1: Y2Mate API
  try {
    const res1 = await fetchUrl('https://www.y2mate.com/mates/analyzeV2/ajax', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://www.y2mate.com',
        'Referer': 'https://www.y2mate.com/',
      },
      body: 'k_query=' + encodeURIComponent(url) + '&k_page=home&hl=en&q_auto=0',
    });
    const json1 = parseJson(res1.body);
    if (json1 && json1.status === 'Ok' && json1.links) {
      const mp4Links = json1.links.mp4 || {};
      const medias = [];
      const qualities = ['1080p', '720p', '480p', '360p'];
      for (const q of qualities) {
        if (mp4Links[q]) {
          medias.push({ url: mp4Links[q].url || null, quality: q, ext: 'mp4', k: mp4Links[q].k, vid: json1.vid });
        }
      }
      if (json1.vid) {
        return {
          platform: 'youtube',
          type: 'video',
          videoId: json1.vid,
          title: json1.title || '',
          thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          medias: medias.length ? medias : [{ quality: '360p', ext: 'mp4' }],
          note: 'Use /api/ytdl?vid={vid}&k={k} to get direct download link',
        };
      }
    }
  } catch {}

  // Method 2: Cobalt API (best free YT downloader API)
  try {
    const res = await fetchUrl('https://co.wuk.sh/api/json', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ url, vCodec: 'h264', vQuality: '720', aFormat: 'mp3', isNoTTWatermark: true }),
    });
    const json = parseJson(res.body);
    if (json && json.url) {
      return {
        platform: 'youtube',
        type: 'video',
        title: json.filename || 'YouTube Short',
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        medias: [{ url: json.url, quality: '720p', ext: 'mp4' }],
      };
    }
  } catch {}

  // Fallback: Return thumbnail at least
  return {
    platform: 'youtube',
    type: 'video',
    videoId,
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    medias: [],
    note: 'Direct download unavailable. Open in YouTube.',
    youtubeUrl: `https://www.youtube.com/shorts/${videoId}`,
  };
}

// ── FACEBOOK HANDLER ──────────────────────────────────────────────────────────
async function handleFacebook(url) {
  // Method 1: Getfvid
  try {
    const res = await fetchUrl('https://getfvid.com/downloader', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://getfvid.com',
        'Referer': 'https://getfvid.com/',
      },
      body: 'url=' + encodeURIComponent(url),
    });
    // Parse HD/SD links from HTML
    const hdMatch = res.body.match(/href="(https:\/\/[^"]+\.mp4[^"]*)"[^>]*>[^<]*HD/i);
    const sdMatch = res.body.match(/href="(https:\/\/[^"]+\.mp4[^"]*)"[^>]*>[^<]*SD/i);
    const medias = [];
    if (hdMatch) medias.push({ url: hdMatch[1], quality: 'HD', ext: 'mp4' });
    if (sdMatch) medias.push({ url: sdMatch[1], quality: 'SD', ext: 'mp4' });
    if (medias.length) {
      return { platform: 'facebook', type: 'video', medias };
    }
  } catch {}

  // Method 2: Cobalt
  try {
    const res = await fetchUrl('https://co.wuk.sh/api/json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const json = parseJson(res.body);
    if (json && json.url) {
      return { platform: 'facebook', type: 'video', medias: [{ url: json.url, quality: 'HD', ext: 'mp4' }] };
    }
  } catch {}

  return null;
}

// ── PINTEREST HANDLER ─────────────────────────────────────────────────────────
async function handlePinterest(url) {
  // Method 1: Scrape Pinterest OEmbed
  try {
    const oembedUrl = 'https://www.pinterest.com/oembed.json?url=' + encodeURIComponent(url);
    const res = await fetchUrl(oembedUrl);
    const json = parseJson(res.body);
    if (json && json.thumbnail_url) {
      return {
        platform: 'pinterest',
        type: 'image',
        medias: [{ url: json.thumbnail_url, quality: 'Original', ext: 'jpg' }],
        thumbnail: json.thumbnail_url,
        title: json.title || '',
      };
    }
  } catch {}

  // Method 2: Scrape page for video_url
  try {
    const res = await fetchUrl(url);
    const vidMatch = res.body.match(/"video_url":"([^"]+)"/);
    const imgMatch = res.body.match(/"orig":{"url":"([^"]+)"/);
    const thumbMatch = res.body.match(/"url":"(https:\/\/i\.pinimg\.com[^"]+)"/);
    if (vidMatch) {
      return {
        platform: 'pinterest',
        type: 'video',
        medias: [{ url: vidMatch[1].replace(/\\\//g, '/'), quality: 'HD', ext: 'mp4' }],
        thumbnail: thumbMatch ? thumbMatch[1].replace(/\\\//g, '/') : null,
      };
    }
    if (imgMatch) {
      const imgUrl = imgMatch[1].replace(/\\\//g, '/');
      return {
        platform: 'pinterest',
        type: 'image',
        medias: [{ url: imgUrl, quality: 'Original', ext: 'jpg' }],
        thumbnail: imgUrl,
      };
    }
  } catch {}

  return null;
}

// ── TWITTER / X HANDLER ───────────────────────────────────────────────────────
async function handleTwitter(url) {
  try {
    const res = await fetchUrl('https://co.wuk.sh/api/json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const json = parseJson(res.body);
    if (json && json.url) {
      return { platform: 'twitter', type: 'video', medias: [{ url: json.url, quality: 'HD', ext: 'mp4' }] };
    }
    if (json && json.picker) {
      const medias = json.picker.map(p => ({ url: p.url, quality: 'HD', ext: 'mp4', thumb: p.thumb }));
      return { platform: 'twitter', type: 'video', medias };
    }
  } catch {}
  return null;
}

// ── TIKTOK HANDLER ────────────────────────────────────────────────────────────
async function handleTikTok(url) {
  // Method 1: Cobalt (no watermark)
  try {
    const res = await fetchUrl('https://co.wuk.sh/api/json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ url, isNoTTWatermark: true }),
    });
    const json = parseJson(res.body);
    if (json && json.url) {
      return { platform: 'tiktok', type: 'video', medias: [{ url: json.url, quality: 'HD', ext: 'mp4' }] };
    }
  } catch {}

  // Method 2: Musicaldown
  try {
    const res = await fetchUrl('https://musicaldown.com/api/dl', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://musicaldown.com',
        'Referer': 'https://musicaldown.com/',
      },
      body: 'id=' + encodeURIComponent(url),
    });
    const json = parseJson(res.body);
    if (json && json.mp4_1) {
      return {
        platform: 'tiktok',
        type: 'video',
        medias: [
          { url: json.mp4_1, quality: 'No Watermark', ext: 'mp4' },
          { url: json.mp4_2 || json.mp4_1, quality: 'Watermark', ext: 'mp4' },
        ],
        thumbnail: json.cover || null,
        title: json.title || '',
      };
    }
  } catch {}

  return null;
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // OPTIONS preflight
  if (req.method === 'OPTIONS') {
    return res.writeHead(200, CORS).end();
  }

  // Set CORS on all responses
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  // Get URL param
  const reqUrl = new URL(req.url, 'http://localhost');
  let mediaUrl = reqUrl.searchParams.get('url') || reqUrl.searchParams.get('link') || '';

  // Also support POST body
  if (!mediaUrl && req.method === 'POST') {
    const body = await new Promise((resolve) => {
      let d = '';
      req.on('data', chunk => d += chunk);
      req.on('end', () => resolve(d));
    });
    try {
      const parsed = JSON.parse(body);
      mediaUrl = parsed.url || parsed.link || '';
    } catch {
      const params = new URLSearchParams(body);
      mediaUrl = params.get('url') || params.get('link') || '';
    }
  }

  if (!mediaUrl) {
    return res.writeHead(400).end(JSON.stringify({
      success: false, error: 'Missing ?url= parameter',
      usage: 'GET /api/download?url=<media_url>',
      supported: ['instagram', 'youtube_shorts', 'facebook', 'pinterest', 'twitter', 'tiktok'],
    }));
  }

  const platform = detectPlatform(mediaUrl);

  let result = null;
  try {
    if (platform === 'instagram') result = await handleInstagram(mediaUrl);
    else if (platform === 'youtube') result = await handleYoutube(mediaUrl);
    else if (platform === 'facebook') result = await handleFacebook(mediaUrl);
    else if (platform === 'pinterest') result = await handlePinterest(mediaUrl);
    else if (platform === 'twitter') result = await handleTwitter(mediaUrl);
    else if (platform === 'tiktok') result = await handleTikTok(mediaUrl);
    else {
      return res.writeHead(400).end(JSON.stringify({
        success: false,
        error: 'Unsupported platform',
        supported: ['instagram', 'youtube_shorts', 'facebook', 'pinterest', 'twitter', 'tiktok'],
      }));
    }
  } catch (err) {
    return res.writeHead(500).end(JSON.stringify({ success: false, error: 'Server error: ' + err.message }));
  }

  if (!result) {
    return res.writeHead(404).end(JSON.stringify({
      success: false,
      error: 'Could not extract media. Post may be private or platform changed its structure.',
      platform,
    }));
  }

  return res.writeHead(200).end(JSON.stringify({ success: true, ...result }));
};
