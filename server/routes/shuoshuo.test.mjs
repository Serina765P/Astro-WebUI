import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'astro-webui-shuoshuo-'));
process.env.BLOG_ROOT = root;
const shardDir = path.join(root, 'src', 'data', 'shuoshuo');
await fsp.mkdir(shardDir, { recursive: true });

const shard = (items) => ({
  source: 'test',
  fetched_at: '2026-01-01T00:00:00+08:00',
  count: items.length,
  items,
});
const item = (id, published_at) => ({
  id,
  title: id,
  type: 'MAIL',
  content: `内容 ${id}`,
  images: [],
  link: '',
  like: 0,
  published_at,
});
await fsp.writeFile(path.join(shardDir, '2025.json'), `${JSON.stringify(shard([item('old', '2025-12-31T23:00:00+08:00')]), null, 2)}\n`);
await fsp.writeFile(path.join(shardDir, '2026.json'), `${JSON.stringify(shard([item('new', '2026-01-01T09:00:00+08:00')]), null, 2)}\n`);

const { register } = await import(`./shuoshuo.js?test=${Date.now()}`);
const routes = new Map();
register((method, route, handler) => routes.set(`${method} ${route}`, handler));

async function call(method, route, body = {}, params = {}) {
  let result;
  await routes.get(`${method} ${route}`)({ body, params, json: (status, data) => { result = { status, data }; } });
  return result;
}

let response = await call('GET', '/api/shuoshuo');
assert.equal(response.status, 200);
assert.deepEqual(response.data.items.map((entry) => entry.id), ['new', 'old']);
assert.equal(response.data.count, 2);

const duplicateShard = shard([item('new', '2026-01-01T09:00:00+08:00'), item('old', '2026-01-02T09:00:00+08:00')]);
await fsp.writeFile(path.join(shardDir, '2026.json'), `${JSON.stringify(duplicateShard, null, 2)}\n`);
await assert.rejects(() => call('GET', '/api/shuoshuo'), /说说 id 重复：old/);
await fsp.writeFile(
  path.join(shardDir, '2026.json'),
  `${JSON.stringify(shard([item('new', '2026-01-01T09:00:00+08:00')]), null, 2)}\n`,
);

response = await call('POST', '/api/shuoshuo', {
  title: '跨年测试前',
  content: '新增内容',
  published_at: '2025-06-01T12:00',
});
assert.equal(response.status, 201);
const createdId = response.data.id;
assert.notEqual(createdId, 'old');
const createdShard = JSON.parse(await fsp.readFile(path.join(shardDir, '2025.json'), 'utf8'));
assert.equal(createdShard.count, 2);
assert.equal(createdShard.items.some((entry) => entry.id === createdId), true);

response = await call('PUT', '/api/shuoshuo/:id', {
  title: '移动到下一年',
  content: '更新后的内容',
  published_at: '2026-02-01T08:00',
}, { id: 'old' });
assert.equal(response.status, 200);
const oldShardAfterMove = JSON.parse(await fsp.readFile(path.join(shardDir, '2025.json'), 'utf8'));
const newShardAfterMove = JSON.parse(await fsp.readFile(path.join(shardDir, '2026.json'), 'utf8'));
assert.equal(oldShardAfterMove.count, 1);
assert.equal(newShardAfterMove.count, 2);
assert.equal(newShardAfterMove.items.some((entry) => entry.id === 'old'), true);

response = await call('DELETE', '/api/shuoshuo/:id', {}, { id: createdId });
assert.equal(response.status, 200);
const emptyShard = JSON.parse(await fsp.readFile(path.join(shardDir, '2025.json'), 'utf8'));
assert.equal(emptyShard.count, 0);
assert.deepEqual(emptyShard.items, []);

response = await call('GET', '/api/shuoshuo');
assert.equal(response.data.count, 2);
assert.deepEqual(response.data.items.map((entry) => entry.id), ['old', 'new']);

await fsp.rm(root, { recursive: true, force: true });
console.log('shuoshuo shard tests passed');
