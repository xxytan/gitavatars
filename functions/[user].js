export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);
  const queryUser = requestUrl.searchParams.get('u');

  // 优先使用 ?u=用户名，否则使用路径参数
  const user = queryUser || context.params.user;
  if (!user) {
    return new Response('Missing user ID or username. Use /123 or /username or ?u=username', { status: 400 });
  }

  const apiHeaders = { 'User-Agent': 'Cloudflare-Proxy' };
  if (context.env.GITHUB_TOKEN) {
    apiHeaders['Authorization'] = `token ${context.env.GITHUB_TOKEN}`;
  }

  const forceUsername = !!queryUser;
  const isNumeric = /^\d+$/.test(user);
  const isUid = isNumeric && !forceUsername; // 仅当无 ?u 且路径为纯数字时当作 UID

  // ==================== 用户名：查询 UID 并 302 跳转 ====================
  if (forceUsername || !isUid) {
    const cache = caches.default;
    const cacheKey = `https://uid-cache/u:${user}`;
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
        const redirectUrl = new URL(`/${id}`, requestUrl.origin).toString();

        // 302 重定向，缓存 30 分钟
        response = new Response(null, {
          status: 302,
          headers: {
            Location: redirectUrl,
            'Cache-Control': 'public, s-maxage=1800'
          }
        });

        context.waitUntil(cache.put(cacheKey, response.clone()));
      } catch (e) {
        return new Response(`Error: ${e.message}`, { status: 500 });
      }
    }
    return response;
  }

  // ==================== UID：返回头像 ====================
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

    const headers = new Headers(imgRes.headers);
    // 头像缓存 30 分钟
    headers.set('Cache-Control', 'public, max-age=1800, s-maxage=1800');

    return new Response(imgRes.body, {
      status: imgRes.status,
      statusText: imgRes.statusText,
      headers,
    });
  } catch (e) {
    return new Response(`Error: ${e.message}`, { status: 500 });
  }
}