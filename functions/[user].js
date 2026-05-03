export async function onRequest(context) {
  const user = context.params.user;
  if (!user) return new Response('Missing user ID or username', { status: 400 });

  // 准备 API 请求头（可选 GITHUB_TOKEN）
  const apiHeaders = { 'User-Agent': 'Cloudflare-Proxy' };
  if (context.env.GITHUB_TOKEN) {
    apiHeaders['Authorization'] = `token ${context.env.GITHUB_TOKEN}`;
  }

  const isNumeric = /^\d+$/.test(user);

  // === 用户名：查询 UID 并重定向 ===
  if (!isNumeric) {
    try {
      const apiRes = await fetch(`https://api.github.com/users/${user}`, { headers: apiHeaders });
      if (!apiRes.ok) return new Response(`GitHub user not found (${apiRes.status})`, { status: 502 });
      const { id } = await apiRes.json();
      const url = new URL(context.request.url);
      return Response.redirect(`${url.origin}/${id}`, 302);
    } catch (e) {
      return new Response(`Error: ${e.message}`, { status: 500 });
    }
  }

  // === UID：直接返回头像 ===
  try {
    const imgRes = await fetch(`https://avatars.githubusercontent.com/u/${user}`, {
      headers: { 'User-Agent': 'Cloudflare-Proxy' },
      redirect: 'manual',
    });

    if (imgRes.status !== 200 && imgRes.status !== 304) return new Response(`Upstream ${imgRes.status}`, { status: 502 });
    const ct = imgRes.headers.get('content-type');
    if (!ct?.startsWith('image/')) return new Response('Not an image', { status: 502 });

    const proxy = new Response(imgRes.body, imgRes);
    proxy.headers.set('Cache-Control', 'public, max-age=43200, s-maxage=43200');
    return proxy;
  } catch (e) {
    return new Response(`Error: ${e.message}`, { status: 500 });
  }
}