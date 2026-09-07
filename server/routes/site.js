// 站点信息路由：site-info.json（侧栏文案、社交链接、友链）。
// 消费方是 astro-blog site.config.ts 的 SIDEBAR：description 字符串、
// social[{name, icon, href}]、friendLinks[{name, href}]
// （friendLinks 的 avatar/description 是工作台预留的可选扩展字段，博客模板暂未渲染）。

import { paths, atomicWrite, readJsonFile } from '../blog.js';
import { HttpError } from '../http.js';

function saveSite(body) {
  if (typeof body.description !== 'string') throw new HttpError(400, 'description 需为字符串');
  if (!Array.isArray(body.social)) throw new HttpError(400, 'social 需为数组');
  if (!Array.isArray(body.friendLinks)) throw new HttpError(400, 'friendLinks 需为数组');

  const social = body.social.map((s, i) => {
    if (!s || typeof s.name !== 'string' || typeof s.icon !== 'string' || typeof s.href !== 'string') {
      throw new HttpError(400, `social[${i}] 需包含 name/icon/href 字符串`);
    }
    return { name: s.name, icon: s.icon, href: s.href };
  });

  const friendLinks = body.friendLinks.map((l, i) => {
    if (!l || typeof l.name !== 'string' || typeof l.href !== 'string') {
      throw new HttpError(400, `friendLinks[${i}] 至少需要 name/href 字符串`);
    }
    const item = { name: l.name, href: l.href };
    if (typeof l.avatar === 'string' && l.avatar) item.avatar = l.avatar;
    if (typeof l.description === 'string' && l.description) item.description = l.description;
    return item;
  });

  return { description: body.description, social, friendLinks };
}

export function register(route) {
  route('GET', '/api/site', async (ctx) => ctx.json(200, await readJsonFile(paths.siteInfo())));

  route('PUT', '/api/site', async (ctx) => {
    const data = saveSite(ctx.body ?? {});
    await atomicWrite(paths.siteInfo(), `${JSON.stringify(data, null, 2)}\n`);
    ctx.json(200, data);
  });
}
