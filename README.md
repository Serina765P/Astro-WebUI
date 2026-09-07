# Astro-WebUI

为 [astro-blog](../astro-blog) 准备的**纯本地** WebUI 编辑工作台：快捷编辑文章、说说、中英 URI 对照与站点信息（含友链）。不做 git 自动提交 —— 发布权始终在你手里。

## 启动

```bash
npm start          # http://localhost:4310（PORT 可覆盖）
```

前置条件：astro-blog 克隆在并列目录（`../astro-blog`），或用环境变量指定：

```bash
BLOG_ROOT=D:\path\to\astro-blog npm start
```

## 功能（单页四个 Tab）

| Tab | 说明 |
| --- | --- |
| **文章** | 列表（搜索 + 分类/标签筛选）、编辑 frontmatter 与正文（marked 即时预览）、新建（slug 实时校验 ASCII）、删除（同名资源文件夹提示保留） |
| **说说** | 发一条（新条目置顶）、行内编辑 content/title/published_at、删除；信封与 `worker/` 邮件拉取契约一致（`type: 'MAIL'`、本地 id 用 `local_<时间戳>`） |
| **URI 对照** | 分类/标签两张 slug 映射表 + 分类配色；顶部横幅列出「正在使用但缺映射」的名称，一键补录 —— 缺了映射 URL 会退化成中文 |
| **站点信息** | 侧栏简介、社交链接、友链 CRUD |

所有日期一律按 **北京时间 (+08:00)** 生成与折算，不依赖本机时区（Pages 构建机是 UTC 的教训）。

## 工作流

1. `npm start` → 浏览器打开 `http://localhost:4310` 编辑；
2. 另开终端在 astro-blog 里 `npm run dev` 看真实渲染（工作台原子写入，热更新即时生效）；
3. 满意后**手动**按中文 Conventional Commits 提交推送，CF Pages 自动构建。

## API 一览

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/status` | 博客根路径与端口 |
| `GET /api/posts` | 全部文章摘要，按日期倒序 |
| `GET/PUT/DELETE /api/posts/:slug` | 读 / 写（保留未知 frontmatter 字段）/ 删单篇 |
| `POST /api/posts` | 新建，slug 冲突 409 |
| `GET/POST /api/shuoshuo` · `PUT/DELETE /api/shuoshuo/:id` | 说说 CRUD，`fetched_at`/`count` 自动维护 |
| `GET/PUT /api/taxonomy` | 三张映射表读写 |
| `GET /api/taxonomy/unmapped` | 扫描全部文章，列出缺映射的分类/标签 |
| `GET/PUT /api/site` | 侧栏简介 / 社交 / 友链 |

错误统一返回 `{ "error": "文案" }` + 对应状态码。

## 已知行为

- 通过工作台保存 `site-info.json` / `taxonomy.json` / `shuoshuo.json` 时会以 2 空格缩进重排 JSON（语义不变，格式归一）。
- 编辑文章保留 frontmatter 里的未知字段（对齐 zod schema 的宽松策略）。
- 不做图片上传：随文图片仍手动放 `src/content/posts/<slug>/`，正文相对引用 `![说明](<slug>/文件名.webp)`（新建文章的正文模板里有提示注释）。

## 技术栈

Node ESM，零框架：`node:http` 手写小路由，依赖仅 `yaml`（frontmatter）与 `marked`（预览，浏览器版由 `/vendor/marked.js` 从 node_modules 直接映射）。前端 vanilla HTML/CSS/JS 单页，无构建步骤。
