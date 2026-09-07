// astro-blog 仓库定位与文件读写。
// BLOG_ROOT 可用环境变量覆盖（自动化测试指向沙盒副本），缺省假定与本仓库并列：../astro-blog。

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError } from './http.js';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // server/ 的上级

export const BLOG_ROOT = path.resolve(
  process.env.BLOG_ROOT || path.join(repoRoot, '..', 'astro-blog'),
);

const POSTS_DIR = path.join(BLOG_ROOT, 'src', 'content', 'posts');

export const paths = {
  postsDir: () => POSTS_DIR,
  postFile: (slug) => path.join(POSTS_DIR, `${slug}.md`),
  assetDir: (slug) => path.join(POSTS_DIR, slug),
  shuoshuo: () => path.join(BLOG_ROOT, 'src', 'data', 'shuoshuo.json'),
  taxonomy: () => path.join(BLOG_ROOT, 'src', 'data', 'taxonomy.json'),
  siteInfo: () => path.join(BLOG_ROOT, 'src', 'data', 'site-info.json'),
};

/** 启动时快速失败：博客目录不存在就别起服务 */
export function assertBlogRoot() {
  if (!fs.existsSync(POSTS_DIR)) {
    throw new Error(
      `在 ${BLOG_ROOT} 下找不到 src/content/posts/。确认 astro-blog 已克隆到并列目录，或用环境变量 BLOG_ROOT 指定。`,
    );
  }
}

/** 原子写：先写临时文件再 rename，避免 astro dev 吃进半截文件 */
export async function atomicWrite(filePath, content) {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(tmp, content, 'utf8');
  await fsp.rename(tmp, filePath);
}

export async function readJsonFile(filePath) {
  let raw;
  try {
    raw = await fsp.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') throw new HttpError(404, `文件不存在：${filePath}`);
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(500, `JSON 解析失败（文件可能被改坏）：${filePath}`);
  }
}
