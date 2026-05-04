export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);
  const queryUser = requestUrl.searchParams.get('u');

  // 提取尺寸参数（GitHub 原生支持 ?s=数值 或 ?size=数值，最大 460px）
  const size = requestUrl.searchParams.get('size') || requestUrl.searchParams.get('s');

  // 从路径中提取用户参数
  let pathUser = context.params.path;
  if (Array.isArray(pathUser)) {
    pathUser = pathUser[0] || '';
  } else {
    pathUser = pathUser || '';
  }

  const user = queryUser || (pathUser.length > 0 ? pathUser : null);
  if (!user) {
    return new Response('Missing user ID or username. Use /123 or /username or ?u=username', { status: 400 });
  }

  const apiHeaders = { 'User-Agent': 'Cloudflare-Proxy' };
  if (context.env.GITHUB_TOKEN) {
    apiHeaders['Authorization'] = `token ${context.env.GITHUB_TOKEN}`;
  }

  const forceUsername = !!queryUser;
  const isNumeric = /^\d+$/.test(user);
  const isUid = isNumeric && !forceUsername;

  // ========== 用户名查询 → 302 重定向 ==========
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

        response = new Response(null, {
          status: 302,
          headers: {
            Location: redirectUrl,
            'Cache-Control': 'public, s-maxage=1800',
          },
        });

        context.waitUntil(cache.put(cacheKey, response.clone()));
      } catch (e) {
        return new Response(`Error: ${e.message}`, { status: 500 });
      }
    }
    return response;
  }

  // ========== UID → 返回头像 ==========
  try {
    // 💡 构造 GitHub 头像 URL，如果用户传了 size，则拼上 ?s= 参数
    let avatarUrl = `https://avatars.githubusercontent.com/u/${user}`;
    if (size) {
      avatarUrl += `?s=${size}`;
    }

    const imgRes = await fetch(avatarUrl, {
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
    // 💡 缓存 Key 已包含尺寸参数（因为 URL 不同），所以直接设置通用缓存时间即可
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