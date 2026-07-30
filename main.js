export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/^\/+|\/+$/g, '');
      const userParam = path.split('/')[0]?.trim();

      // ====== 1. 静态首页 ======
      if (!userParam) {
        // 把你的 index.html 内容直接粘贴在这个模板字符串里
        const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>GitAvatars</title>
</head>
<body>
  <h1>GitAvatars</h1>
  <p>
    A site fully mirrored <a href="https://avatars.githubusercontent.com/u" target="_blank">GitHub User Avatar</a>.<br>
    Kinder to users from CN Mainland.
  </p>
  <h2>Usage</h2>
  <p>
    Request:
    <ol>
      <li><code>/&lt;uid></code></li>
      <li><code>&lt;username></code></li>
      <li><code>/-&lt;username></code></li>
    </ol>
    <i>
      Replace <code>&lt;uid></code> with your <mark>GitHub user ID</mark> &amp; <code>&lt;username></code> with your <mark>GitHub username</mark>.<br>
      If your username is only digits, please use the <strong>3rd method</strong>.
    </i>
  </p>
  <h2>Final Redirected URL</h2>
  <p>
    <code>/&lt;uid></code> or <code>/&lt;uid>&lt;parameters></code>
  </p>
  <h2>Notice</h2>
  <p>
    <li>Cache expiration is 30 minutes.</li>
    <li>You could get your user ID by executing <code>curl -L api.github.com/users/&lt;username></code> .</li>
  </p>
</body>
</html>`;
        return new Response(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      const size = url.searchParams.get('size') || url.searchParams.get('s');

      // ----- 多 Token -----
      const rawTokens = env.GITHUB_TOKENS || env.GITHUB_TOKEN || '';
      const tokens = rawTokens.split(',').map(t => t.trim()).filter(Boolean);
      const baseHeaders = { 'User-Agent': 'Cloudflare-Worker' };

      async function fetchWithToken(targetUrl, attempt = 0) {
        if (attempt >= tokens.length) throw new Error('All tokens exhausted');
        const headers = { ...baseHeaders };
        const token = tokens[attempt];
        if (token) headers['Authorization'] = `token ${token}`;
        const res = await fetch(targetUrl, { headers });
        if ((res.status === 401 || res.status === 403) && tokens.length > 0) {
          return fetchWithToken(targetUrl, attempt + 1);
        }
        return res;
      }

      const isForced = userParam.startsWith('-');
      const raw = isForced ? userParam.slice(1) : userParam;
      const isUid = /^\d+$/.test(raw) && !isForced;

      // ----- 2. 用户名 → 302 跳转 -----
      if (!isUid) {
        const cache = caches.default;
        const cacheKey = `https://uid-cache.local/${raw}`;
        let uid = null;
        const cached = await cache.match(cacheKey);
        if (cached) uid = await cached.text();

        if (!uid) {
          const api = await fetchWithToken(`https://api.github.com/users/${raw}`);
          if (!api.ok) {
            return new Response(
              api.status === 403 ? 'Rate limited' : `User ${api.status}`,
              { status: 502 }
            );
          }
          const data = await api.json();
          uid = data.id?.toString();
          if (!uid) return new Response('Failed to get user ID', { status: 502 });

          const cachedResponse = new Response(uid, {
            headers: { 'Cache-Control': 'public, s-maxage=1800' },
          });
          ctx.waitUntil(cache.put(cacheKey, cachedResponse.clone()));
        }

        const redirectUrl = `/${uid}${url.search}`;
        return new Response(null, {
          status: 302,
          headers: {
            Location: redirectUrl,
            'Cache-Control': 'no-cache',
          },
        });
      }

      // ----- 3. UID → 返回头像 -----
      const imgUrl = `https://avatars.githubusercontent.com/u/${raw}${size ? `?s=${size}` : ''}`;
      const img = await fetch(imgUrl, { headers: baseHeaders, redirect: 'manual' });
      if (img.status !== 200 && img.status !== 304) {
        return new Response(`Upstream ${img.status}`, { status: 502 });
      }
      const ct = img.headers.get('content-type') || '';
      if (!ct.startsWith('image/')) return new Response('Not an image', { status: 502 });

      const newHeaders = new Headers(img.headers);
      newHeaders.set('Cache-Control', 'public, max-age=1800, s-maxage=1800');
      return new Response(img.body, {
        status: img.status,
        statusText: img.statusText,
        headers: newHeaders,
      });
    } catch (e) {
      return new Response('Error: ' + e.message, { status: 500 });
    }
  },
};