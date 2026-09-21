'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { app } = require('../server');

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function request(path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const data = Buffer.from(JSON.stringify(body || {}));
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : {} });
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const baseBody = {
  circumference: 400,
  seamWidth: 20,
  zones: [
    { start: 60, end: 120 },
    { start: 200, end: 260 },
  ],
};

test('/api/compute: 不传 gear 时结果无档位（关闭约束行为不变）', async () => {
  const res = await request('/api/compute', baseBody);
  assert.equal(res.status, 200);
  assert.equal(res.body.gear, null);
  assert.ok(res.body.best);
});

test('/api/compute: enabled=false 视为未启用', async () => {
  const res = await request('/api/compute', { ...baseBody, gear: { enabled: false } });
  assert.equal(res.status, 200);
  assert.equal(res.body.gear, null);
});

test('/api/compute: 启用档位返回可用档位与默认档', async () => {
  const res = await request('/api/compute', {
    ...baseBody,
    gear: { enabled: true, positions: 8, offsetDeg: 0 },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.gear.positions, 8);
  assert.deepEqual(res.body.gear.usable.map((u) => u.deg), [0, 135, 270, 315]);
  assert.equal(res.body.gear.best.deg, 315);
});

test('/api/compute: 零位偏移服务端归一到 [0,360)', async () => {
  const res = await request('/api/compute', {
    ...baseBody,
    gear: { enabled: true, positions: 5, offsetDeg: 400 },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.gear.offsetDeg, 40);
});

test('/api/compute: 档位参数非法时 400', async () => {
  const bad = [
    { enabled: true, positions: 1 },
    { enabled: true, positions: 361 },
    { enabled: true, positions: 12.5 },
    { enabled: true, positions: '12' },
    { enabled: true, positions: null },
    { enabled: true, positions: 4, offsetDeg: 'x' },
  ];
  for (const gear of bad) {
    const res = await request('/api/compute', { ...baseBody, gear });
    assert.equal(res.status, 400, `应拒绝 ${JSON.stringify(gear)}`);
    assert.match(res.body.error, /档位|偏移/);
  }
});

test('/api/compute: gear 类型错误时 400', async () => {
  const res = await request('/api/compute', { ...baseBody, gear: 'nope' });
  assert.equal(res.status, 400);
});

test('/api/compute: 有可行段但无可用档位时返回 nearest，且 noSolution=false', async () => {
  const res = await request('/api/compute', {
    ...baseBody,
    gear: { enabled: true, positions: 2, offsetDeg: 50 },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.noSolution, false);
  assert.equal(res.body.gear.usable.length, 0);
  assert.equal(res.body.gear.best, null);
  assert.ok(res.body.gear.nearest);
  assert.ok(res.body.gear.nearest.before.distanceDeg > 0);
});

test('/api/compute-multi: 启用档位返回各规格间隙', async () => {
  const res = await request('/api/compute-multi', {
    circumferences: [400, 200],
    seamWidth: 20,
    zones: [{ start: 60, end: 120 }],
    gear: { enabled: true, positions: 4 },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.gear.usable.map((u) => u.deg), [0, 270]);
  assert.equal(res.body.gear.best.deg, 270);
  assert.equal(res.body.gear.best.gaps.length, 2);
});

test('/api/compute-multi: 档位数非法 400；不传 gear 行为不变', async () => {
  const okBody = {
    circumferences: [400, 200],
    seamWidth: 20,
    zones: [{ start: 60, end: 120 }],
  };
  const ok = await request('/api/compute-multi', okBody);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.gear, null);

  const bad = await request('/api/compute-multi', {
    ...okBody,
    gear: { enabled: true, positions: 0 },
  });
  assert.equal(bad.status, 400);
});
