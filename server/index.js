// 本地工作台入口：node:http 手写小路由 + public/ 静态文件。
// 不上框架 —— 26 篇文章的规模用不着，也省一层依赖。默认端口 4310，PORT 可覆盖。

import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertBlogRoot, BLOG_ROOT } from './blog.js';
import { HttpError, json, readJsonBody } from './http.js';
import { register as postsRoutes } from './routes/posts.js';
import { register as shuoshuoRoutes } from './routes/shuoshuo.js';
import { register as taxonomyRoutes } from './routes/taxonomy.js';
import { register as siteRoutes } from './routes/site.js';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC_DIR = path.join(repoRoot, 'public');
const PORT = Number(process.env.PORT) || 4310;

const routes = [];

/** 注册路由：'/api/posts/:slug' 里的 :slug 进 params */
function addRoute(method, pathname, handler) {
  const keys = [];
  const source = pathname.replace(/:[A-Za-z]+/g, (seg) => {
    keys.push(seg.slice(1));
    return '([^/]+)';
  });
  routes.push({ method, pattern: new RegExp(`^${source}$`), keys, handler });
}

[postsRoutes, shuoshuoRoutes, taxonomyRoutes, siteRoutes].forEach((reg) => reg(addRoute));

// 只读状态：界面头部展示博客根路径，避免 BLOG_ROOT 指错目录还浑然不觉
addRoute('GET', '/api/status', (ctx) => ctx.json(200, { blogRoot: BLOG_ROOT, port: PORT }));

async function handleApi(req, res, pathname) {
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.pattern.exec(pathname);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const body = req.method === 'POST' || req.method === 'PUT' ? await readJsonBody(req) : {};
    await r.handler({ req, res, params, body, json: (status, data) => json(res, status, data) });
    return true;
  }
  return false;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function serveStatic(res, pathname) {
  let filePath;
  if (pathname === '/vendor/marked.js') {
    // marked 的 UMD 包直接从 node_modules 提供，浏览器端即时预览用
    filePath = path.join(repoRoot, 'node_modules', 'marked', 'lib', 'marked.umd.js');
  } else {
    filePath = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
    if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return false; // 防目录穿越
  }
  let data;
  try {
    data = await fsp.readFile(filePath);
  } catch {
    return false;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream' });
  res.end(data);
  return true;
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (pathname.startsWith('/api/')) {
      if (!(await handleApi(req, res, pathname))) {
        json(res, 404, { error: `未知接口：${req.method} ${pathname}` });
      }
      return;
    }
    if (await serveStatic(res, pathname)) return;
    json(res, 404, { error: 'Not Found' });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error(`[500] ${req.method} ${pathname}\n`, err);
    if (!res.headersSent) json(res, status, { error: err.message || '服务器内部错误' });
    else res.end();
  }
});

assertBlogRoot();
server.listen(PORT, () => {
  console.log('Astro-WebUI 工作台已启动');
  console.log(`  地址：http://localhost:${PORT}`);
  console.log(`  博客：${BLOG_ROOT}`);
});
