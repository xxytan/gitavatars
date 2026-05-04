export async function onRequest(context) {
  const user = context.params.user;
  if (!user) return new Response('Missing user ID or username', { status: 400 });

  const apiHeaders = { 'User-Agent': 'Cloudflare-Proxy' };
  if (context.env.GITHUB_TOKEN) {
    apiHeaders['Authorization'] = `token ${context.env.GITHUB_TOKEN}`;
  }

  const isNumeric = /^\d+$/.test(user);

  if (!isNumeric) {
    const cache = caches.default;
    const cacheKey = `https://uid-cache/${user}`;
    let response = await cache.match(cacheKey);

    if (!response) {
      try {
        const apiRes = await fetch(`https://api.github.com/users/${user}`, { headers: apiHeaders });
        if (!apiRes.ok) {
          if (apiRes.status === 403) {
            return new Response('GitHub API rate limit exceeded. Add GITHUB_TOKEN or wait.', { status: 502 });
          }
          return new Response(`GitHub user not found (${apiRes.status})`, { status: 502 });
        }
        const { id } = await apiRes.json();
        const redirectUrl = new URL(`/${id}`, context.request.url).toString();

        // 手动构造 302 响应，一并写入缓存头，避免修改 immutable headers
        response = new Response(null, {
          status: 302,
          headers: {
            'Location': redirectUrl,
            'Cache-Control': 'public, s-maxage=86400'
          }
        });

        context.waitUntil(cache.put(cacheKey, response.clone()));
      } catch (e) {
        return new Response(`Error: ${e.message}`, { status: 500 });
      }
    }
    return response;
  }

  // UID：返回头像
  try {
    const imgRes = await fetch(`https://avatars.githubusercontent.com/u/${user}`, {
      headers: { 'User-Agent': 'Cloudflare-Proxy' },
      redirect: 'manual',
    });

    if (imgRes.status !== 200 && imgRes.status !== 304) {
      return new Response(`Upstream ${imgRes.status}`, { status: 502 });
    }
    const ct = imgRes.headers.get('content-type');
    if (!ct?.startsWith('image/')) {
      return new Response('Not an image', { status: 502 });
    }

    // 同样用构造方式，避免修改原 headers
    const headers = new Headers(imgRes.headers);
    headers.set('Cache-Control', 'public, max-age=43200, s-maxage=43200');

    return new Response(imgRes.body, {
      status: imgRes.status,
      statusText: imgRes.statusText,
      headers
    });
  } catch (e) {
    return new Response(`Error: ${e.message}`, { status: 500 });
  }
}