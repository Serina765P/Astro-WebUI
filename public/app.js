// Astro-WebUI 前端单页逻辑：文章 / 说说 / URI 对照 / 站点信息 四个 tab。
// 无框架无构建 —— 原生 DOM + fetch。所有日期按北京时间(+08:00)展示与提交：
// datetime-local 的原始值直接交给服务端折算，浏览器本地时区不掺和。

'use strict';

/* ================= 小工具 ================= */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const pad2 = (n) => String(n).padStart(2, '0');

/** 任意 ISO 时间 → 北京时间挂钟的 datetime-local 值（YYYY-MM-DDTHH:mm） */
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = new Date(d.getTime() + 8 * 3600e3);
  return `${p.getUTCFullYear()}-${pad2(p.getUTCMonth() + 1)}-${pad2(p.getUTCDate())}T${pad2(p.getUTCHours())}:${pad2(p.getUTCMinutes())}`;
}

/** 北京时间挂钟的日期部分，列表展示用 */
function bjDate(iso) {
  const v = toLocalInput(iso);
  return v ? v.slice(0, 10) : '';
}

/** 现在的北京时间，头部时钟用 */
function bjNow() {
  const p = new Date(Date.now() + 8 * 3600e3);
  return `${p.getUTCFullYear()}-${pad2(p.getUTCMonth() + 1)}-${pad2(p.getUTCDate())} ${pad2(p.getUTCHours())}:${pad2(p.getUTCMinutes())}:${pad2(p.getUTCSeconds())}`;
}

/** fetch 封装：非 2xx 抛出服务端给的 error 文案 */
async function api(method, url, body) {
  const opt = { method };
  if (body !== undefined) {
    opt.headers = { 'Content-Type': 'application/json' };
    opt.body = JSON.stringify(body);
  }
  const res = await fetch(url, opt);
  let data = null;
  try { data = await res.json(); } catch { /* 非 JSON 响应按 null 处理 */ }
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

let toastTimer = 0;
function toast(msg, isErr = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('err', isErr);
  el.classList.add('is-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-show'), 2800);
}

/** ASCII 名称能直接当 slug 用就给个建议值，中文留空让用户自己定 */
function suggestSlug(name) {
  const s = String(name).trim().toLowerCase().replace(/[\s_]+/g, '-');
  return /^[a-z0-9][a-z0-9-]*$/.test(s) ? s : '';
}

/* ================= 全局状态 ================= */

const state = {
  posts: [],     // /api/posts 摘要列表
  tax: { categorySlugs: {}, tagSlugs: {}, categoryColors: {} }, // 映射缓存，芯片警告用
  currentSlug: null,
  extraFm: {},   // 编辑中的未知 frontmatter 字段，保存时原样带回
  dirty: false,
};

const KNOWN_FM = ['title', 'date', 'updated', 'skin', 'description', 'keywords', 'tags', 'categories'];
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function markDirty() {
  if (!state.currentSlug) return;
  state.dirty = true;
  $('#dirty-dot').hidden = false;
}

function clearDirty() {
  state.dirty = false;
  $('#dirty-dot').hidden = true;
}

/* ================= Tab 切换 ================= */

async function switchTab(name) {
  if (state.dirty && name !== 'posts' && state.currentSlug) {
    if (!confirm(`「${state.currentSlug}」有未保存的修改。确定放弃修改并切换？`)) return;
    await openPost(state.currentSlug, { silent: true }); // 重新读取，恢复原样
  }
  $$('.tab').forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle('is-active', on);
    t.setAttribute('aria-selected', String(on));
  });
  $$('.panel').forEach((p) => {
    const on = p.id === `tab-${name}`;
    p.classList.toggle('is-active', on);
    p.hidden = !on;
  });
  const loaders = { posts: loadPosts, shuoshuo: loadShuoshuo, taxonomy: loadTaxonomyTab, site: loadSite };
  loaders[name]?.().catch((err) => toast(err.message, true));
}

/* ================= 文章 ================= */

function rebuildDatalists() {
  const tags = new Set(), cats = new Set();
  state.posts.forEach((p) => {
    (p.tags ?? []).forEach((t) => tags.add(t));
    (p.categories ?? []).forEach((c) => cats.add(c));
  });
  const fill = (dl, values) => {
    dl.innerHTML = '';
    [...values].sort().forEach((v) => {
      const o = document.createElement('option');
      o.value = v;
      dl.append(o);
    });
  };
  fill($('#dl-tags'), tags);
  fill($('#dl-categories'), cats);
}

function fillSelect(sel, values, allLabel) {
  const cur = sel.value;
  sel.innerHTML = '';
  sel.append(new Option(allLabel, ''));
  values.forEach((v) => sel.append(new Option(v, v)));
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

function rebuildFilters() {
  const cats = new Set(), tags = new Set();
  state.posts.forEach((p) => {
    (p.categories ?? []).forEach((c) => cats.add(c));
    (p.tags ?? []).forEach((t) => tags.add(t));
  });
  fillSelect($('#filter-category'), [...cats].sort(), '全部分类');
  fillSelect($('#filter-tag'), [...tags].sort(), '全部标签');
}

function renderPostList() {
  const kw = $('#post-search').value.trim().toLowerCase();
  const fc = $('#filter-category').value;
  const ft = $('#filter-tag').value;
  const list = $('#post-list');
  list.innerHTML = '';
  const shown = state.posts.filter((p) =>
    (!kw || (p.title ?? '').toLowerCase().includes(kw) || p.slug.toLowerCase().includes(kw)) &&
    (!fc || (p.categories ?? []).includes(fc)) &&
    (!ft || (p.tags ?? []).includes(ft)));
  if (!shown.length) {
    const li = document.createElement('li');
    li.textContent = kw || fc || ft ? '没有匹配的文章' : '（还没有文章）';
    li.style.color = 'var(--sub)';
    list.append(li);
    return;
  }
  for (const p of shown) {
    const li = document.createElement('li');
    li.dataset.slug = p.slug;
    if (p.slug === state.currentSlug) li.classList.add('is-active');
    const title = document.createElement('div');
    title.className = 'pl-title';
    title.textContent = p.title || p.slug;
    const meta = document.createElement('div');
    meta.className = 'pl-meta';
    const d = document.createElement('span');
    d.className = 'mono';
    d.textContent = bjDate(p.date);
    meta.append(d);
    if ((p.categories ?? []).length) {
      const s = document.createElement('span');
      s.textContent = p.categories.join(' / ');
      meta.append(s);
    }
    if ((p.tags ?? []).length) {
      const s = document.createElement('span');
      s.textContent = '#' + p.tags.join(' #');
      meta.append(s);
    }
    li.append(title, meta);
    li.addEventListener('click', () => openPost(p.slug));
    list.append(li);
  }
}

async function loadPosts() {
  state.posts = await api('GET', '/api/posts');
  rebuildFilters();
  rebuildDatalists();
  renderPostList();
}

/* ---------- 芯片输入（tags / categories） ---------- */

function chipsController(root, kind) {
  const input = root.querySelector('input');
  const tableKey = kind === 'tags' ? 'tagSlugs' : 'categorySlugs';
  let values = [];

  const isUnmapped = (v) => !(v in (state.tax[tableKey] ?? {}));

  function render() {
    $$('.chip', root).forEach((c) => c.remove());
    for (const v of values) {
      const chip = document.createElement('span');
      chip.className = 'chip' + (isUnmapped(v) ? ' chip-warn' : '');
      if (isUnmapped(v)) chip.title = '缺 slug 映射，文章 URL 会退化成中文 —— 去「URI 对照」补一条';
      const text = document.createElement('span');
      text.textContent = v;
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = '×';
      del.title = '移除';
      del.addEventListener('click', () => {
        values = values.filter((x) => x !== v);
        render();
        markDirty();
      });
      chip.append(text, del);
      root.insertBefore(chip, input);
    }
  }

  function add(raw) {
    const v = String(raw).trim();
    if (!v) return;
    if (!values.includes(v)) {
      values.push(v);
      render();
      markDirty();
    }
    input.value = '';
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(input.value);
    } else if (e.key === 'Backspace' && !input.value && values.length) {
      values.pop();
      render();
      markDirty();
    }
  });
  // 从 datalist 选中或失焦时也收进来
  input.addEventListener('change', () => { if (input.value.trim()) add(input.value); });

  return {
    set(arr) { values = [...(arr ?? [])]; render(); },
    get() { return [...values]; },
  };
}

const catChips = chipsController($('#f-categories'), 'categories');
const tagChips = chipsController($('#f-tags'), 'tags');

/* ---------- 编辑器 ---------- */

async function openPost(slug, { silent = false } = {}) {
  if (state.dirty && !silent) {
    if (!confirm('当前文章有未保存的修改，打开新文章将丢弃，确定？')) return;
  }
  try {
    const post = await api('GET', `/api/posts/${encodeURIComponent(slug)}`);
    state.currentSlug = slug;
    state.extraFm = {};
    const fm = post.frontmatter ?? {};
    for (const [k, v] of Object.entries(fm)) {
      if (!KNOWN_FM.includes(k)) state.extraFm[k] = v; // 未知字段原样保留
    }
    $('#editor-empty').hidden = true;
    $('#editor').hidden = false;
    $('#editor-slug').textContent = slug;
    $('#f-title').value = fm.title ?? '';
    $('#f-date').value = toLocalInput(fm.date);
    $('#f-skin').value = fm.skin ?? '';
    const hasUpdated = !!fm.updated;
    $('#f-updated-on').checked = hasUpdated;
    $('#f-updated-field').hidden = !hasUpdated;
    $('#f-updated').value = hasUpdated ? toLocalInput(fm.updated) : '';
    $('#f-description').value = fm.description ?? '';
    $('#f-keywords').value = (fm.keywords ?? []).join(', ');
    catChips.set(fm.categories);
    tagChips.set(fm.tags);
    $('#f-body').value = post.body ?? '';
    renderPreview();
    clearDirty();
    renderPostList();
  } catch (err) {
    toast(err.message, true);
  }
}

function collectFrontmatter() {
  const fm = { ...state.extraFm };
  fm.title = $('#f-title').value.trim();
  fm.date = $('#f-date').value; // datetime-local 原始值，服务端按 +08:00 折算
  if ($('#f-updated-on').checked && $('#f-updated').value) fm.updated = $('#f-updated').value;
  else delete fm.updated;
  if ($('#f-skin').value) fm.skin = $('#f-skin').value;
  else delete fm.skin;
  const desc = $('#f-description').value.trim();
  if (desc) fm.description = desc;
  else delete fm.description;
  const kws = $('#f-keywords').value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  if (kws.length) fm.keywords = kws;
  else delete fm.keywords;
  fm.tags = tagChips.get();
  fm.categories = catChips.get();
  return fm;
}

async function savePost() {
  if (!state.currentSlug || $('#editor').hidden) return;
  const slug = state.currentSlug;
  try {
    const saved = await api('PUT', `/api/posts/${encodeURIComponent(slug)}`, {
      frontmatter: collectFrontmatter(),
      body: $('#f-body').value,
    });
    clearDirty();
    toast(`已保存：${slug}`);
    // 就地更新摘要，不打断筛选状态
    const fm = saved.frontmatter ?? {};
    const p = state.posts.find((x) => x.slug === slug);
    if (p) {
      Object.assign(p, {
        title: fm.title ?? '',
        date: fm.date ?? '',
        updated: fm.updated ?? null,
        tags: fm.tags ?? [],
        categories: fm.categories ?? [],
        description: fm.description ?? '',
        skin: fm.skin ?? null,
      });
    }
    rebuildDatalists();
    renderPostList();
  } catch (err) {
    toast(err.message, true);
  }
}

async function deletePost() {
  const slug = state.currentSlug;
  if (!slug || $('#editor').hidden) return;
  if (!confirm(`确定删除文章「${slug}」？此操作直接删除文件，不可撤销。`)) return;
  try {
    const r = await api('DELETE', `/api/posts/${encodeURIComponent(slug)}`);
    state.currentSlug = null;
    clearDirty();
    $('#editor').hidden = true;
    $('#editor-empty').hidden = false;
    await loadPosts();
    toast(r.assetFolderKept
      ? `已删除 ${slug}；同名资源文件夹保留了，需要的话手动删`
      : `已删除 ${slug}`, r.assetFolderKept);
  } catch (err) {
    toast(err.message, true);
  }
}

/* ---------- 即时预览 ---------- */

let previewTimer = 0;
function renderPreview() {
  const el = $('#preview');
  const md = $('#f-body').value;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    if (window.marked?.parse) {
      try {
        el.innerHTML = window.marked.parse(md);
        return;
      } catch { /* 解析失败退回纯文本 */ }
    }
    el.textContent = md;
  }, 120);
}

/* ---------- 新建文章对话框 ---------- */

function setupNewPostDialog() {
  const dialog = $('#new-post-dialog');
  const hint = $('#np-hint');

  $('#btn-new-post').addEventListener('click', () => {
    $('#np-slug').value = '';
    $('#np-title').value = '';
    hint.textContent = '';
    hint.classList.remove('ok');
    $('#np-create').disabled = true;
    dialog.showModal();
  });
  $('#np-cancel').addEventListener('click', () => dialog.close());

  $('#np-slug').addEventListener('input', () => {
    const v = $('#np-slug').value.trim();
    if (!v) {
      hint.textContent = '';
      hint.classList.remove('ok');
      $('#np-create').disabled = true;
    } else if (!SLUG_RE.test(v)) {
      hint.textContent = '仅限 ASCII 字母/数字/连字符/下划线，且以字母或数字开头';
      hint.classList.remove('ok');
      $('#np-create').disabled = true;
    } else {
      hint.textContent = '可以用';
      hint.classList.add('ok');
      $('#np-create').disabled = false;
    }
  });

  $('#new-post-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const slug = $('#np-slug').value.trim();
    const title = $('#np-title').value.trim();
    try {
      await api('POST', '/api/posts', { slug, title: title || undefined });
      dialog.close();
      toast(`已创建：${slug}`);
      await loadPosts();
      await openPost(slug, { silent: true });
    } catch (err) {
      hint.textContent = err.message;
      hint.classList.remove('ok');
    }
  });
}

/* ================= 说说 ================= */

function shuoshuoItem(item) {
  const li = document.createElement('li');
  li.className = 'ss-item card';
  li.dataset.id = item.id;

  const head = document.createElement('div');
  head.className = 'ss-head';
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = item.type || 'MAIL';
  const time = document.createElement('input');
  time.type = 'datetime-local';
  time.value = toLocalInput(item.published_at);
  time.title = '发布时间（北京时间）';
  const title = document.createElement('input');
  title.type = 'text';
  title.placeholder = '标题（可留空）';
  title.value = item.title ?? '';
  const idSpan = document.createElement('span');
  idSpan.className = 'mono';
  idSpan.textContent = item.id;
  idSpan.title = '条目 id（与邮件 Worker 的契约字段，别改）';
  head.append(badge, time, title, idSpan);

  const grid = document.createElement('div');
  grid.className = 'ss-grid';
  const content = document.createElement('textarea');
  content.rows = 3;
  content.value = item.content ?? '';
  grid.append(content);

  const actions = document.createElement('div');
  actions.className = 'ss-actions';
  const save = document.createElement('button');
  save.className = 'btn btn-primary';
  save.textContent = '保存';
  const del = document.createElement('button');
  del.className = 'btn btn-danger';
  del.textContent = '删除';
  actions.append(save, del);

  save.addEventListener('click', async () => {
    const c = content.value.trim();
    if (!c) { toast('内容不能为空', true); return; }
    try {
      await api('PUT', `/api/shuoshuo/${encodeURIComponent(item.id)}`, {
        title: title.value,
        content: c,
        published_at: time.value || null, // 清空 = 保持原时间
      });
      toast('说说已保存');
    } catch (err) { toast(err.message, true); }
  });
  del.addEventListener('click', async () => {
    if (!confirm(`确定删除这条说说（${item.id}）？shuoshuo.json 里的条目会被移除。`)) return;
    try {
      await api('DELETE', `/api/shuoshuo/${encodeURIComponent(item.id)}`);
      toast('已删除');
      await loadShuoshuo();
    } catch (err) { toast(err.message, true); }
  });

  li.append(head, grid, actions);
  return li;
}

async function loadShuoshuo() {
  const data = await api('GET', '/api/shuoshuo');
  const list = $('#ss-list');
  list.innerHTML = '';
  const items = data.items ?? [];
  for (const item of items) list.append(shuoshuoItem(item));
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '还没有说说，先发一条？';
    list.append(li);
  }
}

function setupShuoshuo() {
  $('#ss-send').addEventListener('click', async () => {
    const content = $('#ss-content').value.trim();
    if (!content) { toast('先写点什么再发', true); return; }
    try {
      await api('POST', '/api/shuoshuo', {
        title: $('#ss-title').value,
        content,
        published_at: $('#ss-time').value || undefined, // 留空 = 服务端取当前北京时间
      });
      $('#ss-title').value = '';
      $('#ss-time').value = '';
      $('#ss-content').value = '';
      toast('已写入 shuoshuo.json（新条目在最上面）');
      await loadShuoshuo();
    } catch (err) { toast(err.message, true); }
  });
}

/* ================= URI 对照 ================= */

function mapRow(nameVal, valVal, namePh, valPh) {
  const tr = document.createElement('tr');
  const tdName = document.createElement('td');
  const name = document.createElement('input');
  name.type = 'text';
  name.value = nameVal ?? '';
  name.placeholder = namePh;
  tdName.append(name);
  const tdVal = document.createElement('td');
  const val = document.createElement('input');
  val.type = 'text';
  val.value = valVal ?? '';
  val.placeholder = valPh;
  tdVal.append(val);
  const tdDel = document.createElement('td');
  const del = document.createElement('button');
  del.className = 'row-del';
  del.type = 'button';
  del.textContent = '×';
  del.title = '删除此行';
  del.addEventListener('click', () => tr.remove());
  tdDel.append(del);
  tr.append(tdName, tdVal, tdDel);
  return tr;
}

const TABLE_PLACEHOLDERS = {
  categorySlugs: ['分类名', 'slug'],
  tagSlugs: ['标签名', 'slug'],
  categoryColors: ['分类名', 'CSS 变量'],
};

function renderTaxTable(tbodyId, data) {
  const [namePh, valPh] = TABLE_PLACEHOLDERS[tbodyId.slice(6)] ?? ['', ''];
  const tb = $(tbodyId);
  tb.innerHTML = '';
  Object.entries(data ?? {}).forEach(([k, v]) => tb.append(mapRow(k, v, namePh, valPh)));
}

function readTaxTable(tbodyId) {
  const obj = {};
  $$(`${tbodyId} tr`).forEach((tr) => {
    const inputs = $$('input', tr);
    const name = inputs[0].value.trim();
    const val = inputs[1].value.trim();
    if (name && val) obj[name] = val;
  });
  return obj;
}

async function loadTaxonomyTab() {
  state.tax = await api('GET', '/api/taxonomy');
  renderTaxTable('#rows-categorySlugs', state.tax.categorySlugs);
  renderTaxTable('#rows-tagSlugs', state.tax.tagSlugs);
  renderTaxTable('#rows-categoryColors', state.tax.categoryColors);
  await refreshUnmapped();
}

async function refreshUnmapped() {
  const banner = $('#unmapped-banner');
  let data;
  try {
    data = await api('GET', '/api/taxonomy/unmapped');
  } catch {
    banner.hidden = true;
    return;
  }
  const cats = data.categories ?? [];
  const tags = data.tags ?? [];
  banner.innerHTML = '';
  if (!cats.length && !tags.length) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  const h = document.createElement('h2');
  h.textContent = '以下名称正在被文章使用、但没有 slug 映射（URL 会退化成中文）。填好 slug 点「补录」加入对应表，再保存映射表。';
  banner.append(h);
  const addRow = (name, kind) => {
    const row = document.createElement('div');
    row.className = 'unmapped-row';
    const nameInput = document.createElement('input');
    nameInput.readOnly = true;
    nameInput.value = name;
    nameInput.title = kind === 'cat' ? '分类' : '标签';
    const slugInput = document.createElement('input');
    slugInput.placeholder = '英文 slug';
    slugInput.value = suggestSlug(name);
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost';
    btn.textContent = '补录';
    btn.addEventListener('click', () => {
      const v = slugInput.value.trim();
      if (!v) { toast('先填个 slug 再补录', true); return; }
      const [namePh, valPh] = kind === 'cat' ? TABLE_PLACEHOLDERS.categorySlugs : TABLE_PLACEHOLDERS.tagSlugs;
      $(kind === 'cat' ? '#rows-categorySlugs' : '#rows-tagSlugs').append(mapRow(name, v, namePh, valPh));
      row.remove();
      toast('已加到对应表格，记得点「保存映射表」');
    });
    row.append(nameInput, slugInput, btn);
    return row;
  };
  cats.forEach((n) => banner.append(addRow(n, 'cat')));
  tags.forEach((n) => banner.append(addRow(n, 'tag')));
}

function setupTaxonomy() {
  $$('.add-row').forEach((btn) => btn.addEventListener('click', () => {
    const ph = TABLE_PLACEHOLDERS[btn.dataset.table] ?? ['', ''];
    $(`#rows-${btn.dataset.table}`).append(mapRow('', '', ...ph));
  }));

  $('#btn-save-taxonomy').addEventListener('click', async () => {
    const payload = {
      categorySlugs: readTaxTable('#rows-categorySlugs'),
      tagSlugs: readTaxTable('#rows-tagSlugs'),
      categoryColors: readTaxTable('#rows-categoryColors'),
    };
    try {
      state.tax = await api('PUT', '/api/taxonomy', payload);
      toast('映射表已保存');
      await refreshUnmapped();
      // 让当前打开文章的芯片警告按新映射刷新（set 不标记脏）
      catChips.set(catChips.get());
      tagChips.set(tagChips.get());
    } catch (err) { toast(err.message, true); }
  });
}

/* ================= 站点信息 ================= */

function siteRow(values, placeholders) {
  const tr = document.createElement('tr');
  values.forEach((v, i) => {
    const td = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = v ?? '';
    input.placeholder = placeholders[i];
    td.append(input);
    tr.append(td);
  });
  const tdDel = document.createElement('td');
  const del = document.createElement('button');
  del.className = 'row-del';
  del.type = 'button';
  del.textContent = '×';
  del.title = '删除此行';
  del.addEventListener('click', () => tr.remove());
  tdDel.append(del);
  tr.append(tdDel);
  return tr;
}

const SOCIAL_PH = ['名称', '图标（如 simple-icons:github）', '链接'];
const FRIEND_PH = ['名称', '链接', '头像 URL（可选）', '描述（可选）'];

async function loadSite() {
  const data = await api('GET', '/api/site');
  $('#site-description').value = data.description ?? '';
  const socialTb = $('#rows-social');
  socialTb.innerHTML = '';
  (data.social ?? []).forEach((s) => socialTb.append(siteRow([s.name, s.icon, s.href], SOCIAL_PH)));
  const flTb = $('#rows-friendLinks');
  flTb.innerHTML = '';
  (data.friendLinks ?? []).forEach((l) =>
    flTb.append(siteRow([l.name, l.href, l.avatar ?? '', l.description ?? ''], FRIEND_PH)));
}

function setupSite() {
  $('#btn-add-social').addEventListener('click', () => $('#rows-social').append(siteRow(['', '', ''], SOCIAL_PH)));
  $('#btn-add-friend').addEventListener('click', () => $('#rows-friendLinks').append(siteRow(['', '', '', ''], FRIEND_PH)));

  $('#btn-save-site').addEventListener('click', async () => {
    let bad = 0;
    const social = [];
    $$('#rows-social tr').forEach((tr) => {
      const [name, icon, href] = $$('input', tr).map((i) => i.value.trim());
      if (!name && !icon && !href) return; // 整行空白，忽略
      if (!name || !href) { bad += 1; return; }
      social.push({ name, icon: icon || '', href });
    });
    const friendLinks = [];
    $$('#rows-friendLinks tr').forEach((tr) => {
      const [name, href, avatar, description] = $$('input', tr).map((i) => i.value.trim());
      if (!name && !href && !avatar && !description) return;
      if (!name || !href) { bad += 1; return; }
      const item = { name, href };
      if (avatar) item.avatar = avatar;
      if (description) item.description = description;
      friendLinks.push(item);
    });
    if (bad) { toast(`有 ${bad} 行缺名称或链接，补全后再保存`, true); return; }
    try {
      await api('PUT', '/api/site', {
        description: $('#site-description').value,
        social,
        friendLinks,
      });
      toast('站点信息已保存');
    } catch (err) { toast(err.message, true); }
  });
}

/* ================= 启动 ================= */

function init() {
  // 头部北京时间时钟
  const tick = () => { $('#clock').textContent = bjNow(); };
  tick();
  setInterval(tick, 1000);

  // 工作台状态（头部显示博客根路径）
  api('GET', '/api/status')
    .then((st) => { $('#blog-root').textContent = st.blogRoot; })
    .catch((err) => toast(`拿不到工作台状态：${err.message}`, true));
  // 映射缓存（芯片警告用）；映射文件缺失不拦着用
  api('GET', '/api/taxonomy').then((t) => { state.tax = t; }).catch(() => {});

  // Tab
  $$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

  // 文章列表工具
  $('#post-search').addEventListener('input', renderPostList);
  $('#filter-category').addEventListener('change', renderPostList);
  $('#filter-tag').addEventListener('change', renderPostList);

  // 编辑器
  $('#btn-save-post').addEventListener('click', savePost);
  $('#btn-delete-post').addEventListener('click', deletePost);
  $('#f-body').addEventListener('input', () => { markDirty(); renderPreview(); });
  $('#editor').addEventListener('input', markDirty);
  $('#f-updated-on').addEventListener('change', () => {
    const on = $('#f-updated-on').checked;
    $('#f-updated-field').hidden = !on;
    if (on && !$('#f-updated').value) $('#f-updated').value = toLocalInput(new Date().toISOString());
  });

  setupNewPostDialog();
  setupShuoshuo();
  setupTaxonomy();
  setupSite();

  // 未保存就离开页面给个拦截
  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });
  // Ctrl+S 保存当前文章
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      savePost();
    }
  });

  loadPosts().catch((err) => toast(err.message, true));
}

init();
