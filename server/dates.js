// 日期工具：博客所有渲染统一按 Asia/Shanghai（Pages 构建机是 UTC 的教训），
// 这里全部自己折算成 +08:00，绝不依赖本机时区。

const TZ_OFFSET_MIN = 8 * 60;

/** Date → +08:00 下的日历部件 */
function partsInTz(date) {
  const shifted = new Date(date.getTime() + TZ_OFFSET_MIN * 60_000);
  return {
    y: String(shifted.getUTCFullYear()).padStart(4, '0'),
    m: String(shifted.getUTCMonth() + 1).padStart(2, '0'),
    d: String(shifted.getUTCDate()).padStart(2, '0'),
    h: String(shifted.getUTCHours()).padStart(2, '0'),
    min: String(shifted.getUTCMinutes()).padStart(2, '0'),
    s: String(shifted.getUTCSeconds()).padStart(2, '0'),
  };
}

/** 当前时刻 → 'YYYY-MM-DDTHH:mm:ss+08:00'（frontmatter date、说说时间戳都用它） */
export function nowIso8601() {
  const p = partsInTz(new Date());
  return `${p.y}-${p.m}-${p.d}T${p.h}:${p.min}:${p.s}+08:00`;
}

/**
 * datetime-local 原始值（'YYYY-MM-DDTHH:mm[:ss]'，用户按北京时间理解）
 * → 'YYYY-MM-DDTHH:mm:ss+08:00'；格式非法返回 null。
 */
export function localInputToIso8601(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value || ''));
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s || '00'}+08:00`;
}

/**
 * 规整用户提交的时间：datetime-local 值按 +08:00 折算；
 * 已是合法 ISO 串原样保留；非法返回 null。
 */
export function normalizeTimeInput(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  const asLocal = localInputToIso8601(s);
  if (asLocal) return asLocal;
  return Number.isNaN(new Date(s).getTime()) ? null : s;
}

/** 是否可被 zod 的 z.coerce.date() 接受（frontmatter date/updated 校验用） */
export function isDateLike(value) {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}
