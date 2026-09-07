// 文章路由：src/content/posts/*.md（glob 只匹配顶层，slug = 文件名去 .md）。
// frontmatter 用 yaml 库解析/生成 —— 现有文章的列表风格不统一，不能手写。
// 写入校验对齐 astro-blog src/content.config.ts 的 zod schema
// （title/date 必填，skin 仅限 'imas-album'），未知字段原样保留。

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { paths, atomicWrite } from '../blog.js';
import { HttpError } from '../http.js';
import { isDateLike, nowIso8601, normalizeTimeInput } from '../dates.js';

const SKINS = ['imas-album'];
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function assertSlug(slug) {
  if (!SLUG_RE.test(slug)) {
    throw new HttpError(400, `非法 slug：${slug}（仅限 ASCII 字母/数字/连字符/下划线）`);
  }
}

/** 拆开 frontmatter 与正文；正文逐字节保留，crlf 标记用于写回时保持原文件风格 */
export function splitFrontmatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  return {
    data: m ? (parseYaml(m[1]) ?? {}) : {},
    body: m ? raw.slice(m[0].length) : raw,
    crlf: raw.includes('\r\n'),
  };
}

function joinFrontmatter(data, body, crlf) {
  const j = crlf ? '\r\n' : '\n';
  let fm = Object.keys(data).length === 0 ? '' : stringifyYaml(data, { lineWidth: 0 });
  if (crlf) fm = fm.replaceAll('\n', '\r\n');
  return `---${j}${fm}---${j}${body}`;
}

/** 读单篇原始文件；slug 合法性与存在性在这里统一把关 */
async function readRawPost(slug) {
  assertSlug(slug);
  const file = paths.postFile(slug);
  let raw;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') throw new HttpError(404, `文章不存在：${slug}`);
    throw err;
  }
  return { raw, file };
}

/** 全部文章：[{ slug, data, raw }]；解析失败的跳过并告警，不拖垮列表 */
export async function readAllPosts() {
  const dir = paths.postsDir();
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const posts = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const slug = entry.name.slice(0, -3);
    try {
      const raw = await fsp.readFile(path.join(dir, entry.name), 'utf8');
      posts.push({ slug, raw, ...splitFrontmatter(raw) });
    } catch (err) {
      console.warn(`[posts] 跳过解析失败的文章：${entry.name}（${err.message}）`);
    }
  }
  return posts;
}

function validateFrontmatter(data) {
  if (typeof data.title !== 'string' || !data.title.trim()) {
    throw new HttpError(400, 'title 必填且为非空字符串');
  }
  if (!isDateLike(data.date)) throw new HttpError(400, 'date 必填且需为可解析的日期');

  const isStrArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
  if (data.updated != null && !isDateLike(data.updated)) throw new HttpError(400, 'updated 需为可解析的日期');
  if (data.skin != null && !SKINS.includes(data.skin)) throw new HttpError(400, `skin 仅支持：${SKINS.join('、')}`);
  for (const key of ['tags', 'categories', 'keywords']) {
    if (data[key] != null && !isStrArray(data[key])) throw new HttpError(400, `${key} 需为字符串数组`);
  }
  if (data.description != null && typeof data.description !== 'string') {
    throw new HttpError(400, 'description 需为字符串');
  }

  // 置空的可选字段直接移除，不留 null/空串（与 zod 的 .optional() 语义一致）
  for (const key of ['updated', 'skin', 'description', 'keywords', 'tags', 'categories']) {
    if (data[key] == null || data[key] === '') delete data[key];
  }
  return data;
}

async function summaryList() {
  const posts = await readAllPosts();
  return posts
    .map(({ slug, data }) => ({
      slug,
      title: data.title ?? '',
      date: data.date ?? '',
      updated: data.updated ?? null,
      tags: data.tags ?? [],
      categories: data.categories ?? [],
      description: data.description ?? '',
      skin: data.skin ?? null,
    }))
    .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
}

async function createPost(body) {
  const slug = String(body.slug ?? '').trim();
  if (!SLUG_RE.test(slug)) throw new HttpError(400, 'slug 仅限 ASCII 字母/数字/连字符/下划线，且以字母或数字开头');
  const file = paths.postFile(slug);
  if (fs.existsSync(file)) throw new HttpError(409, `slug 已存在：${slug}`);

  const frontmatter = {
    title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : slug,
    date: nowIso8601(),
    tags: [],
    categories: [],
  };
  const bodyText = `<!-- 图片放 src/content/posts/${slug}/ 下，正文相对引用：![说明](${slug}/文件名.webp) -->\n`;
  await atomicWrite(file, joinFrontmatter(frontmatter, bodyText, false));
  return { slug, frontmatter, body: bodyText };
}

async function savePost(slug, body) {
  const { raw } = await readRawPost(slug);
  if (!body || typeof body.frontmatter !== 'object' || Array.isArray(body.frontmatter)) {
    throw new HttpError(400, '缺少 frontmatter 对象');
  }
  if (typeof body.body !== 'string') throw new HttpError(400, '缺少正文字符串 body');

  const data = { ...body.frontmatter };
  for (const key of ['date', 'updated']) {
    if (data[key] == null) continue;
    const norm = normalizeTimeInput(data[key]); // datetime-local 值按北京时间折算
    if (norm == null) throw new HttpError(400, `${key} 不是可解析的日期`);
    data[key] = norm;
  }
  validateFrontmatter(data);
  await atomicWrite(paths.postFile(slug), joinFrontmatter(data, body.body, raw.includes('\r\n')));
  return { slug, frontmatter: data, body: body.body };
}

async function deletePost(slug) {
  const { file } = await readRawPost(slug);
  await fsp.unlink(file);
  let assetFolderKept = false;
  try {
    await fsp.access(paths.assetDir(slug));
    assetFolderKept = true; // 同名资源文件夹提示但不强删
  } catch {}
  return { deleted: slug, assetFolderKept };
}

export function register(route) {
  route('GET', '/api/posts', async (ctx) => ctx.json(200, await summaryList()));
  route('POST', '/api/posts', async (ctx) => ctx.json(201, await createPost(ctx.body)));
  route('GET', '/api/posts/:slug', async (ctx) => {
    const { raw } = await readRawPost(ctx.params.slug);
    const { data, body } = splitFrontmatter(raw);
    ctx.json(200, { slug: ctx.params.slug, frontmatter: data, body });
  });
  route('PUT', '/api/posts/:slug', async (ctx) => ctx.json(200, await savePost(ctx.params.slug, ctx.body)));
  route('DELETE', '/api/posts/:slug', async (ctx) => ctx.json(200, await deletePost(ctx.params.slug)));
}
