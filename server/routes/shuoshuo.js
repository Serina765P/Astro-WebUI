// 说说路由：src/data/shuoshuo.json 单文件，信封 {source, fetched_at, count, items}。
// 与 worker/src/lib.js 的契约保持一致：新条目 unshift 置顶、type 'MAIL'、id 唯一
// （本地条目用 local_<时间戳> 前缀）；fetched_at 在每次变更后刷新，count 重算。

import { paths, atomicWrite, readJsonFile } from '../blog.js';
import { HttpError } from '../http.js';
import { nowIso8601, normalizeTimeInput } from '../dates.js';

async function load() {
  const data = await readJsonFile(paths.shuoshuo());
  if (!data || !Array.isArray(data.items)) {
    throw new HttpError(500, 'shuoshuo.json 结构异常：缺少 items 数组');
  }
  return data;
}

async function save(data) {
  data.source = typeof data.source === 'string' ? data.source : 'mail-to-github';
  data.fetched_at = nowIso8601();
  data.count = data.items.length;
  await atomicWrite(paths.shuoshuo(), `${JSON.stringify(data, null, 2)}\n`);
  return data;
}

function makeLocalId(items) {
  const base = Date.now();
  for (let n = 1; ; n += 1) {
    const id = n === 1 ? `local_${base}` : `local_${base}-${n}`;
    if (!items.some((it) => it.id === id)) return id;
  }
}

function parsePublishedAt(raw) {
  if (raw == null || raw === '') return nowIso8601();
  const t = normalizeTimeInput(raw);
  if (!t) throw new HttpError(400, 'published_at 不是可解析的时间');
  return t;
}

export function register(route) {
  route('GET', '/api/shuoshuo', async (ctx) => ctx.json(200, await load()));

  route('POST', '/api/shuoshuo', async (ctx) => {
    const content = String(ctx.body.content ?? '').trim();
    if (!content) throw new HttpError(400, 'content 必填');
    const data = await load();
    const item = {
      id: makeLocalId(data.items),
      title: typeof ctx.body.title === 'string' ? ctx.body.title.trim() : '',
      type: 'MAIL',
      content,
      images: [],
      link: '',
      like: 0,
      published_at: parsePublishedAt(ctx.body.published_at),
    };
    data.items.unshift(item); // 新条目置顶，与 worker mergeItem 一致
    await save(data);
    ctx.json(201, item);
  });

  route('PUT', '/api/shuoshuo/:id', async (ctx) => {
    const data = await load();
    const item = data.items.find((it) => it.id === ctx.params.id);
    if (!item) throw new HttpError(404, `说说不存在：${ctx.params.id}`);
    if (ctx.body.content != null) {
      const content = String(ctx.body.content).trim();
      if (!content) throw new HttpError(400, 'content 不能为空');
      item.content = content;
    }
    if (ctx.body.title != null) item.title = String(ctx.body.title).trim();
    if (ctx.body.published_at != null) item.published_at = parsePublishedAt(ctx.body.published_at);
    await save(data);
    ctx.json(200, item);
  });

  route('DELETE', '/api/shuoshuo/:id', async (ctx) => {
    const data = await load();
    const before = data.items.length;
    data.items = data.items.filter((it) => it.id !== ctx.params.id);
    if (data.items.length === before) throw new HttpError(404, `说说不存在：${ctx.params.id}`);
    await save(data);
    ctx.json(200, { deleted: ctx.params.id, count: data.items.length });
  });
}
