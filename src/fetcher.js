'use strict';

const MAX_BODY_BYTES = 2 * 1024 * 1024;

async function fetchPage(url, { userAgent, timeoutMs = 10000, fetchImpl = fetch }) {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': userAgent, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });

  const contentType = res.headers.get('content-type') || '';
  const isHtml = /text\/html|application\/xhtml\+xml/i.test(contentType);
  const base = {
    status: res.status,
    ok: res.ok,
    finalUrl: res.url || url,
    contentType,
    size: Number(res.headers.get('content-length')) || null,
  };

  if (!res.ok || !isHtml) {
    await res.body?.cancel();
    return { ...base, html: null };
  }

  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  while (received < MAX_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
  }
  await reader.cancel();

  return { ...base, size: received, html: Buffer.concat(chunks).toString('utf8') };
}

module.exports = { fetchPage };
