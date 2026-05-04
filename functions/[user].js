export async function onRequest(ctx) {
  try {
    const u = new URL(ctx.request.url);
    const size = u.searchParams.get('size') || u.searchParams.get('s');
    const p = (ctx.params.user || '').trim();
    if (!p) return new Response('Missing user', { status: 400 });

    const h = { 'User-Agent': 'Cloudflare-Proxy' };
    if (ctx.env.GITHUB_TOKEN) h['Authorization'] = `token ${ctx.env.GITHUB_TOKEN}`;

    const isForced = p.startsWith('-');
    const raw = isForced ? p.slice(1) : p;
    const isUid = /^\d+$/.test(raw) && !isForced;

    // ========== 用户名：每次都查 GitHub API ==========
    if (!isUid) {
      const api = await fetch(`https://api.github.com/users/${raw}`, { headers: h });
      if (!api.ok) return new Response(api.status === 403 ? 'Rate limited' : `User ${api.status}`, { status: 502 });
      const { id } = await api.json();
      // 保留原始查询参数（如 ?size=64）
      const redirectUrl = `/${id}${u.search}`;
      return new Response(null, {
        status: 302,
        headers: {
          Location: redirectUrl,
          'Cache-Control': 'public, s-maxage=1800'   // 仅 302 响应本身缓存 30 分钟（减少 API 调用）
        }
      });
    }

    // ========== UID：返回头像 ==========
    const img = await fetch(`https://avatars.githubusercontent.com/u/${raw}${size ? `?s=${size}` : ''}`, {
      headers: h,
      redirect: 'manual',
    });
    if (img.status !== 200 && img.status !== 304) return new Response(`Upstream ${img.status}`, { status: 502 });
    if (!(img.headers.get('content-type') || '').startsWith('image/')) return new Response('Not an image', { status: 502 });

    const hd = new Headers(img.headers);
    hd.set('Cache-Control', 'public, max-age=1800, s-maxage=1800');
    return new Response(img.body, { status: img.status, headers: hd });
  } catch (e) {
    return new Response('Error: ' + e.message, { status: 500 });
  }
}