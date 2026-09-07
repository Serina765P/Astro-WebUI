// URI 对照路由：taxonomy.json 的两张 slug 映射表 + 分类配色。
// /unmapped 扫描全部文章，列出「正在使用但没有 slug 映射」的分类/标签
// —— 缺了映射 URL 会退化成中文，这是最实用的防坑提示。

import { paths, atomicWrite, readJsonFile } from '../blog.js';
import { HttpError } from '../http.js';
import { readAllPosts } from './posts.js';

const TABLES = ['categorySlugs', 'tagSlugs', 'categoryColors'];

function isStringMap(v) {
  return (
    !!v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.values(v).every((x) => typeof x === 'string')
  );
}

export function register(route) {
  route('GET', '/api/taxonomy', async (ctx) => ctx.json(200, await readJsonFile(paths.taxonomy())));

  route('GET', '/api/taxonomy/unmapped', async (ctx) => {
    const tax = await readJsonFile(paths.taxonomy());
    const used = { categories: new Set(), tags: new Set() };
    for (const post of await readAllPosts()) {
      (post.data.categories ?? []).forEach((name) => used.categories.add(name));
      (post.data.tags ?? []).forEach((name) => used.tags.add(name));
    }
    const pick = (names, table) =>
      [...names].filter((name) => !(name in (tax[table] ?? {}))).sort();
    ctx.json(200, {
      categories: pick(used.categories, 'categorySlugs'),
      tags: pick(used.tags, 'tagSlugs'),
    });
  });

  route('PUT', '/api/taxonomy', async (ctx) => {
    const incoming = ctx.body ?? {};
    const data = {};
    for (const key of TABLES) {
      if (!isStringMap(incoming[key])) {
        throw new HttpError(400, `${key} 需为「字符串 → 字符串」的映射表`);
      }
      data[key] = incoming[key];
    }
    await atomicWrite(paths.taxonomy(), `${JSON.stringify(data, null, 2)}\n`);
    ctx.json(200, data);
  });
}
