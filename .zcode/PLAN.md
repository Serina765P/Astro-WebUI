# Astro-WebUI 本地工作台 · 交接计划

> 本文档是 ZCode 会话的交接计划。新工作空间(`C:\Projects\Astro-WebUI`)从这里继续。
> **当前状态:尚未写任何代码,astro-blog 仓库无任何改动。**
> (同内容备份在 `C:\Projects\astro-blog\.zcode\1.md`)

## 一、目标

为博客(`C:\Projects\astro-blog`)做一个**纯本地**的 WebUI 编辑工作台,快捷编辑文章与站点信息(含中英 URI 对照)。不做 git 自动提交,发布权留在用户手里。

## 二、已确认的决定(用户拍板)

1. **存放位置**:独立仓库 `C:\Projects\Astro-WebUI`(不是 astro-blog 仓库内),自行 `git init`;并在用户 GitHub 账户(Serina765P)创建**同名仓库 Astro-WebUI** 用来存放,首个 commit 后推送。
2. **功能范围(第一版全做)**:文章编辑、说说管理、中英 URI 对照、站点信息与友链。
3. **TS 内数据改法**:抽成 JSON 数据文件(见下文前置重构),工作台只读写 JSON,不碰 TS。
4. **发布方式**:工作台只读写本地文件;用户手动按中文 Conventional Commits 提交推送,CF Pages 自动构建。

## 三、前置小重构(在 astro-blog 仓库内,一次性)

工作台要安全读写「写在 TS 代码里的数据」,先抽成 JSON:

1. 新建 `src/data/taxonomy.json`:`{ "categorySlugs": {...}, "tagSlugs": {...}, "categoryColors": {...} }`,内容从 `src/site.config.ts` 原样搬出。
2. 新建 `src/data/site-info.json`:友链 `friendLinks` + 侧边栏 `SIDEBAR.description` / `SIDEBAR.social`。
3. `src/site.config.ts` 改为 `import` 这两个 JSON 后按**原有导出名** re-export(`CATEGORY_SLUGS`、`TAG_SLUGS`、`CATEGORY_COLORS`、`SIDEBAR` 等名字全部不变),其余消费方(`tags/[slug].astro`、`categories/[slug].astro`、`PostLayout.astro`、`PostCard.astro`、`links/index.astro` 等)零改动。
4. 跑 `npm run check` + `npm run build` 验证无回归(构建产物 URL 不变)。
5. 重构单独成一个 commit:`refactor(配置): 抽取标签映射与站点信息至数据文件`(中文 Conventional Commits 规范;提交前给用户确认)。

## 四、工作台本体设计

**技术选型**:Node ESM 无框架。后端 `node:http` 手写小路由;依赖只有 `yaml`(frontmatter 解析/生成,现有文章 YAML 列表风格不统一,不能手写解析)和 `marked`(正文即时预览)。前端单页 vanilla HTML/CSS/JS,无构建步骤。规模(26 篇文章 + 小 JSON)不需要更重的东西。

**目录**:
```
Astro-WebUI/
  package.json        # "start": "node server/index.js"
  server/
    index.js          # http 服务 + 静态文件 + 路由分发,默认端口 4310(PORT 可覆盖)
    blog.js           # BLOG_ROOT 定位(env 覆盖,缺省 ../astro-blog)、原子写(tmp+rename)
    dates.js          # 固定生成 +08:00 ISO 时间(不依赖系统时区,构建机是 UTC 的教训)
    routes/posts.js
    routes/shuoshuo.js
    routes/taxonomy.js
    routes/site.js
  public/             # 单页 UI:四个 tab
  README.md
```

**API**:
- `GET /api/posts` — 解析全部 `.md` frontmatter,返回 slug/标题/日期/标签/分类,按日期倒序。
- `GET/PUT /api/posts/:slug` — 读/写单篇;写时校验 frontmatter 对齐 `src/content.config.ts` 的 zod schema(`title`、`date` 必填,`skin` 仅限 `'imas-album'`),保留未知字段,正文原样写回。
- `POST /api/posts` — 新建:slug 必须 ASCII(现有文件名全是英文/拼音),冲突 409,模板自动填 `date: <现在,+08:00>`。
- `DELETE /api/posts/:slug` — 删除(UI 二次确认;同名资源文件夹存在时提示但不强删)。
- `GET/POST/PUT/DELETE /api/shuoshuo[/:id]` — 严格保持 `{source, fetched_at, count, items}` 信封、新条目置顶、`type: 'MAIL'`、id 唯一(本地条目用 `local_<时间戳>` 前缀),与 `worker/src/lib.js` 的 mergeItem 契约一致。
- `GET/PUT /api/taxonomy` — 读写 taxonomy.json;`GET /api/taxonomy/unmapped` — 扫描全部文章,列出**正在使用但没有 slug 映射**的标签/分类(缺了 URL 会退化成中文,最实用的防坑提示)。
- `GET/PUT /api/site` — 读写 site-info.json(友链 CRUD、侧边栏文案/社交链接)。

**UI(单页四 tab)**:
- **文章**:左侧列表(标签/分类筛选 + 标题搜索),右侧编辑器 —— title、datetime-local(自动转 +08:00 ISO)、tags/categories 芯片输入(datalist 补全,未映射的高亮警告)、description、keywords、skin 下拉、updated 开关,正文大 textarea + marked 即时预览分栏。「新文章」弹 slug 输入(实时校验 ASCII)。
- **说说**:条目列表,行内编辑 content/title/published_at,顶部「发一条」prepend,删除带确认。
- **URI 对照**:分类、标签两张映射表增删改,顶部横幅列出「正在使用但缺映射」名称,一键补录。
- **站点信息**:友链表 CRUD(名称/URL/头像/描述)、侧边栏描述与社交链接表单。

**工作流**:`npm start` → 浏览器 `http://localhost:4310` 编辑 → 文件落在 astro-blog 工作区 → 另开终端 `npm run dev` 看真实渲染 → 满意后手动提交推送。

## 五、已探明的 astro-blog 仓库事实(新会话免重探)

- **文章**:`src/content/posts/*.md`(glob 只匹配顶层),**slug = 文件名去 .md**,全英文/拼音;路由 `src/pages/posts/[id].astro` 直接用 `post.id`。frontmatter schema(title/date 必填,updated/tags/categories/keywords/description 可选,skin 枚举 `imas-album`)。日期是 ISO 8601 带 `+08:00`。随文图片放同名子文件夹,正文里相对引用 `![alt](<slug>/xxx.webp)`。
- **说说**:`src/data/shuoshuo.json` 单文件,信封 `{source, fetched_at, count, items}`,item 字段 `id/title/type/content/images[{url,width,height}]/link/like/published_at`,新条目 **unshift 到顶部**。邮件 Worker(`worker/`)通过 GitHub Contents API PUT 同一文件,两边契约必须一致(见 `worker/src/lib.js` 的 `buildItem`/`mergeItem`)。历史 OPUS(B站)条目已清空,现存 1 条 MAIL 测试条目。
- **URI 对照**:现在写死在 `src/site.config.ts` 的 `CATEGORY_SLUGS`(公告→notice、资源分享→resources、技术分享→tech、学习笔记→notes)和 `TAG_SLUGS`(站务→site、偶像大师→idolmaster、学园偶像大师→gakumas、765AS→765as、Hi-Res→hi-res、CD→cd、音乐资源→music、音频处理→audio、FFmpeg→ffmpeg、Windows→windows、输入法→input-method、Rime→rime、数据结构→data-structure、课堂笔记→lecture-notes、题库→question-bank);缺映射时 `?? name` 回退中文 URL。还有 `CATEGORY_COLORS`(分类→莫兰迪 CSS var)。
- **站点信息**:同在 `site.config.ts` —— `SITE`(标题 SerinaP's Blog、副标 芹菜P的部落阁、url https://blog.serinap.top、lang zh-CN)、`HERO`、`NAV`(7 项,Material Symbols 图标)、`SIDEBAR`(description/social/friendLinks)、`GISCUS`(repo Serina765P/Serina-Astro)。新增 nav 图标还要改 `astro.config.mjs` 的 icon include 名单。
- **工具链**:无 CI、无 adapter(纯静态);`npm run build` = `astro build && pagefind --site dist`;部署 CF Pages,`NODE_VERSION=22` 在 Pages 后台配置;无 .nvmrc。`scripts/` 下有三个纯 Node ESM 脚本(migrate-posts / contrast-audit / vendor-fonts),`migrate-posts.mjs` 是唯一写过内容的脚本,可参考其 frontmatter 约定。`playwright-core` 已是 devDep(无测试)。
- **时区教训**:Pages 构建机是 UTC,所有渲染用 `Asia/Shanghai`;工作台生成日期必须自己算 +08:00,不能依赖本机时区。
- **提交规范**:严格 `type(scope): 中文描述`,历史已重写;giscus 已切到新仓库。

## 六、实施顺序(新工作空间从这里开始)

1. astro-blog 内做第三节 JSON 抽取重构并验证构建。
2. 初始化 `C:\Projects\Astro-WebUI`(git init、package.json、`npm i yaml marked`)。
3. 写 server(基础设施 + 四个路由模块)。
4. 写前端单页。
5. GitHub 创建 Serina765P/Astro-WebUI(建议先 private)并推送首个 commit(用 `gh` CLI)。
6. 端到端验证:启动工作台,curl 走一遍各 API 读/写/建/删;确认 astro-blog `npm run dev` 对被改文件正常热更新。

## 七、明确不做(第一版)

- 不做 git 自动提交/推送(发布权在用户手里)。
- 不做图片上传(仍手动放 `src/content/posts/<slug>/`,编辑器提示路径约定;之后想要再加)。
- 不碰 NAV、GISCUS、HERO 等几乎不变的配置(改 TS 风险高收益低)。
