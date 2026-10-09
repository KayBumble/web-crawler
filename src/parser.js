'use strict';

const FILE_EXTENSIONS = new Set([
  'pdf', 'zip', 'gz', 'tar', 'rar', '7z', 'exe', 'msi', 'dmg', 'iso',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico', 'bmp', 'tiff',
  'mp3', 'wav', 'ogg', 'mp4', 'webm', 'mov', 'avi', 'mkv',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'txt', 'xml', 'json',
  'css', 'js', 'woff', 'woff2', 'ttf', 'eot',
]);

function normalizeUrl(raw, base) {
  let url;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  url.username = '';
  url.password = '';
  url.searchParams.sort();
  if (url.pathname !== '/' && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

function isFileUrl(url) {
  const { pathname } = new URL(url);
  const match = /\.([a-z0-9]+)$/i.exec(pathname);
  return Boolean(match && FILE_EXTENSIONS.has(match[1].toLowerCase()));
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function parseHtml(html, pageUrl) {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, ' ').trim() : '';

  const baseMatch = /<base\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i.exec(html);
  const base = baseMatch ? normalizeUrl(decodeEntities(baseMatch[1]), pageUrl) || pageUrl : pageUrl;

  const robotsMeta = /<meta\b[^>]*name\s*=\s*["']robots["'][^>]*>/i.exec(html);
  const nofollow = Boolean(robotsMeta && /nofollow|none/i.test(robotsMeta[0]));

  const links = new Set();
  if (!nofollow) {
    const hrefPattern = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
    let match;
    while ((match = hrefPattern.exec(html))) {
      const href = decodeEntities(match[1] ?? match[2] ?? match[3]).trim();
      const url = normalizeUrl(href, base);
      if (url) links.add(url);
    }
  }

  return { title, links: [...links], nofollow };
}

module.exports = { normalizeUrl, isFileUrl, parseHtml };
