// 说说路由：src/data/shuoshuo/<上海年份>.json 分片，文件内容仍是
// {source, fetched_at, count, items}。GET 聚合返回 envelope，WebUI 前端接口不变。

import fsp from 'node:fs/promises';
import { paths, atomicWrite, readJsonFile } from '../blog.js';
import { HttpError } from '../http.js';
import { nowIso8601, normalizeTimeInput } from '../dates.js';

const TIME_ZONE = 'Asia/Shanghai';

function yearInShanghai(value) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric' }).formatToParts(new Date(value));
  return Number(parts.find((part) => part.type === 'year')?.value);
}

async function listShardFiles() {
  const dir = paths.shuoshuoDir();
  await fsp.mkdir(dir, { recursive: true });
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^\d{4}\.json$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function loadStore() {
  const records = [];
  for (const file of await listShardFiles()) {
    const filePath = paths.shuoshuoShard(file.slice(0, -5));
    const data = await readJsonFile(filePath);
    if (!data || !Array.isArray(data.items)) {
      throw new HttpError(500, `说说分片 ${file} 结构异常：缺少 items 数组`);
    }
    records.push({ file, filePath, data });
  }

  const seen = new Set();
  for (const record of records) {
    for (const item of record.data.items) {
      if (!item || typeof item.id !== 'string' || !item.id) {
        throw new HttpError(500, `说说分片 ${record.file} 存在缺少 id 的条目`);
      }
      if (seen.has(item.id)) throw new HttpError(500, `说说 id 重复：${item.id}`);
      seen.add(item.id);
    }
  }
  return records;
}

function allItems(records) {
  return records.flatMap((record) => record.data.items);
}

function sortItems(items) {
  return [...items].sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
}

function makeLocalId(items) {
  const base = Date.now();
  const ids = new Set(items.map((item) => item.id));
  for (let n = 1; ; n += 1) {
    const id = n === 1 ? `local_${base}` : `local_${base}-${n}`;
    if (!ids.has(id)) return id;
  }
}

function parsePublishedAt(raw) {
  if (raw == null || raw === '') return nowIso8601();
  const time = normalizeTimeInput(raw);
  if (!time) throw new HttpError(400, 'published_at 不是可解析的时间');
  return time;
}

function emptyShard() {
  return { source: 'mail-to-github', fetched_at: nowIso8601(), count: 0, items: [] };
}

async function getOrCreateRecord(records, year) {
  const existing = records.find((record) => record.file === `${year}.json`);
  if (existing) return existing;
  const record = { file: `${year}.json`, filePath: paths.shuoshuoShard(year), data: emptyShard() };
  records.push(record);
  return record;
}

async function saveRecord(record) {
  record.data.source = typeof record.data.source === 'string' ? record.data.source : 'mail-to-github';
  record.data.items = sortItems(record.data.items);
  record.data.fetched_at = nowIso8601();
  record.data.count = record.data.items.length;
  await atomicWrite(record.filePath, `${JSON.stringify(record.data, null, 2)}\n`);
  return record;
}

function findItem(records, id) {
  for (const record of records) {
    const index = record.data.items.findIndex((item) => item.id === id);
    if (index >= 0) return { record, index, item: record.data.items[index] };
  }
  return null;
}

export function register(route) {
  route('GET', '/api/shuoshuo', async (ctx) => {
    const records = await loadStore();
    const items = sortItems(allItems(records));
    const fetchedAt = records
      .map((record) => record.data.fetched_at)
      .filter((value) => typeof value === 'string')
      .sort()
      .at(-1);
    const source = records.find((record) => typeof record.data.source === 'string')?.data.source ?? 'mail-to-github';
    ctx.json(200, {
      source,
      fetched_at: fetchedAt ?? nowIso8601(),
      count: items.length,
      items,
    });
  });

  route('POST', '/api/shuoshuo', async (ctx) => {
    const body = ctx.body ?? {};
    const content = String(body.content ?? '').trim();
    if (!content) throw new HttpError(400, 'content 必填');
    const records = await loadStore();
    const item = {
      id: makeLocalId(allItems(records)),
      title: typeof body.title === 'string' ? body.title.trim() : '',
      type: 'MAIL',
      content,
      images: [],
      link: '',
      like: 0,
      published_at: parsePublishedAt(body.published_at),
    };
    const record = await getOrCreateRecord(records, yearInShanghai(item.published_at));
    record.data.items.unshift(item);
    await saveRecord(record);
    ctx.json(201, item);
  });

  route('PUT', '/api/shuoshuo/:id', async (ctx) => {
    const records = await loadStore();
    const found = findItem(records, ctx.params.id);
    if (!found) throw new HttpError(404, `说说不存在：${ctx.params.id}`);
    const body = ctx.body ?? {};
    if (body.content != null) {
      const content = String(body.content).trim();
      if (!content) throw new HttpError(400, 'content 不能为空');
      found.item.content = content;
    }
    if (body.title != null) found.item.title = String(body.title).trim();
    const oldYear = yearInShanghai(found.item.published_at);
    if (body.published_at != null) found.item.published_at = parsePublishedAt(body.published_at);
    const newYear = yearInShanghai(found.item.published_at);

    if (oldYear !== newYear) {
      found.record.data.items.splice(found.index, 1);
      const target = await getOrCreateRecord(records, newYear);
      target.data.items.push(found.item);
      await saveRecord(found.record);
      if (target !== found.record) await saveRecord(target);
    } else {
      await saveRecord(found.record);
    }
    ctx.json(200, found.item);
  });

  route('DELETE', '/api/shuoshuo/:id', async (ctx) => {
    const records = await loadStore();
    const found = findItem(records, ctx.params.id);
    if (!found) throw new HttpError(404, `说说不存在：${ctx.params.id}`);
    found.record.data.items.splice(found.index, 1);
    await saveRecord(found.record);
    ctx.json(200, { deleted: ctx.params.id, count: allItems(records).length });
  });
}

export const __test = { yearInShanghai, sortItems, parsePublishedAt };
