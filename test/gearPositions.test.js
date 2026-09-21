'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../src/gearPositions');

function approx(actual, expected, eps = 1e-7) {
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} !≈ ${expected}`);
}

test('normalizeGear: 缺省/禁用 → null；启用时校验档位数 2～360 的整数', () => {
  assert.deepEqual(G.normalizeGear(undefined), { ok: true, gear: null });
  assert.deepEqual(G.normalizeGear(null), { ok: true, gear: null });
  assert.deepEqual(G.normalizeGear({ enabled: false }), { ok: true, gear: null });
  assert.equal(G.normalizeGear({ enabled: true, positions: 1 }).ok, false);
  assert.equal(G.normalizeGear({ enabled: true, positions: 361 }).ok, false);
  assert.equal(G.normalizeGear({ enabled: true, positions: 12.5 }).ok, false);
  assert.equal(G.normalizeGear({ enabled: true, positions: '12' }).ok, false);
  assert.equal(G.normalizeGear({ enabled: true, positions: NaN }).ok, false);
  assert.deepEqual(G.normalizeGear({ enabled: true, positions: 2 }).gear, {
    positions: 2,
    offsetDeg: 0,
  });
  assert.deepEqual(G.normalizeGear({ enabled: true, positions: 360 }).gear, {
    positions: 360,
    offsetDeg: 0,
  });
});

test('normalizeGear: 零位偏移按整圈归一（含负值/超界/非数值）', () => {
  assert.equal(G.normalizeGear({ enabled: true, positions: 5, offsetDeg: 400 }).gear.offsetDeg, 40);
  assert.equal(G.normalizeGear({ enabled: true, positions: 5, offsetDeg: -30 }).gear.offsetDeg, 330);
  assert.equal(G.normalizeGear({ enabled: true, positions: 5, offsetDeg: 360 }).gear.offsetDeg, 0);
  assert.equal(G.normalizeGear({ enabled: true, positions: 5, offsetDeg: 'x' }).ok, false);
});

test('gearAngleDeg: 偏移 + n×360/档位，按整圈归一', () => {
  assert.deepEqual(
    [0, 1, 2, 3].map((i) => G.gearAngleDeg(i, 4, 0)),
    [0, 90, 180, 270]
  );
  assert.deepEqual(
    [0, 1, 2].map((i) => G.gearAngleDeg(i, 3, 30)),
    [30, 150, 270]
  );
  assert.equal(G.gearAngleDeg(2, 5, 330), 114); // 330+144=474→114
});

test('arcsToPieces: 跨零弧拆分，整圈归一', () => {
  assert.deepEqual(G.arcsToPieces([{ startDeg: 108, endDeg: 36, widthDeg: 288, wraps: true }]), [
    [0, 36],
    [108, 360],
  ]);
  assert.deepEqual(G.arcsToPieces([{ startDeg: 30, endDeg: 90, widthDeg: 60 }]), [[30, 90]]);
  assert.deepEqual(G.arcsToPieces([{ startDeg: 0, endDeg: 0, widthDeg: 360 }]), [[0, 360]]);
  assert.deepEqual(G.arcsToPieces([]), []);
});

test('evaluateGears: 与可行段相交，列出全部可用档位及间隙', () => {
  // 可行 [108,162] 与 [234,360]∪[0,36]；边界 {36,108,162,234}
  const boundary = [36, 108, 162, 234];
  const pieces = [
    [0, 36],
    [108, 162],
    [234, 360],
  ];
  const r = G.evaluateGears({
    positions: 8,
    offsetDeg: 0,
    feasiblePieces: pieces,
    gapAtDeg: (deg) => G.minDistanceToBoundary(deg, boundary),
  });
  assert.deepEqual(r.usable.map((u) => u.deg), [0, 135, 270, 315]);
  approx(r.usable[0].gapDeg, 36);
  approx(r.usable[1].gapDeg, 27);
  approx(r.usable[2].gapDeg, 36);
  approx(r.usable[3].gapDeg, 81);
  assert.equal(r.best.deg, 315);
  assert.equal(r.best.index, 7);
  assert.equal(r.nearest, null);
});

test('evaluateGears: 边界上的档位视为可用，间隙为 0', () => {
  const r = G.evaluateGears({
    positions: 4,
    offsetDeg: 0,
    feasiblePieces: [
      [90, 180],
      [180, 270],
    ],
    gapAtDeg: (deg) => G.minDistanceToBoundary(deg, [90, 180, 270]),
  });
  assert.deepEqual(r.usable.map((u) => u.deg), [90, 180, 270]);
  assert.equal(r.usable[0].gapDeg, 0);
  assert.ok(r.usable.some((u) => u.gapDeg === 0));
});

test('evaluateGears: 瓶颈间隙并列时角度较小优先', () => {
  // 可行 [0,90]∪[180,270]；4 档：0、90、180、270 全在边界（间隙 0）→ 取 0
  const r = G.evaluateGears({
    positions: 4,
    offsetDeg: 0,
    feasiblePieces: [
      [0, 90],
      [180, 270],
    ],
    gapAtDeg: (deg) => G.minDistanceToBoundary(deg, [0, 90, 180, 270]),
  });
  assert.equal(r.usable.length, 4);
  assert.equal(r.best.deg, 0);
});

test('evaluateGears: 整圈可行时全部档位可用，无禁用边界间隙为 null', () => {
  const r = G.evaluateGears({
    positions: 12,
    offsetDeg: 0,
    feasiblePieces: [[0, 360]],
    gapAtDeg: () => Infinity,
  });
  assert.equal(r.usable.length, 12);
  assert.equal(r.best.deg, 0);
  assert.equal(r.best.gapDeg, null);
  assert.equal(r.nearest, null);
});

test('evaluateGears: 有可行段但无可用档位 → 给出最近前/后档位与角距离', () => {
  // 可行 [108,162] 与 [234,396(=36 跨零)]；2 档偏移 50°：50° 与 230° 均落入禁用区
  const r = G.evaluateGears({
    positions: 2,
    offsetDeg: 50,
    feasiblePieces: [
      [0, 36],
      [108, 162],
      [234, 360],
    ],
    gapAtDeg: () => 0,
  });
  assert.equal(r.usable.length, 0);
  assert.equal(r.best, null);
  assert.ok(r.nearest);
  // 230° 在可行段起点 234° 之前 4°
  assert.equal(r.nearest.before.deg, 230);
  approx(r.nearest.before.distanceDeg, 4);
  assert.equal(r.nearest.before.boundaryDeg, 234);
  // 50°（抬起 410）在跨零段末端 396 之后 14°
  assert.equal(r.nearest.after.deg, 50);
  approx(r.nearest.after.distanceDeg, 14);
  assert.equal(r.nearest.after.boundaryDeg, 36);
});

test('evaluateGears: 最近档位距离并列时取角度较小者', () => {
  // 可行 [80,100] 与 [260,280]；2 档 0°/180° 均在禁用区。
  // before：0° 距 80 为 80、180° 距 260 为 80 → 并列取 0°；
  // after：180° 距 100 为 80、0°（抬起 360）距 280 为 80 → 并列取 0°。
  const r = G.evaluateGears({
    positions: 2,
    offsetDeg: 0,
    feasiblePieces: [
      [80, 100],
      [260, 280],
    ],
    gapAtDeg: () => 0,
  });
  assert.equal(r.usable.length, 0);
  assert.equal(r.nearest.before.deg, 0);
  approx(r.nearest.before.distanceDeg, 80);
  assert.equal(r.nearest.before.boundaryDeg, 80);
  assert.equal(r.nearest.after.deg, 0);
  approx(r.nearest.after.distanceDeg, 80);
  assert.equal(r.nearest.after.boundaryDeg, 280);
});

test('evaluateGears: extraAtDeg 附带各规格间隙', () => {
  const r = G.evaluateGears({
    positions: 2,
    offsetDeg: 0,
    feasiblePieces: [[0, 360]],
    gapAtDeg: () => Infinity,
    extraAtDeg: (deg) => [{ index: 0, gapDeg: deg }],
    extraKey: 'gaps',
  });
  assert.deepEqual(r.usable[0].gaps, [{ index: 0, gapDeg: 0 }]);
  assert.deepEqual(r.usable[1].gaps, [{ index: 0, gapDeg: 180 }]);
});

test('circDistDeg / minDistanceToBoundary: 最短圆弧与无边界 Infinity', () => {
  approx(G.circDistDeg(350, 10), 20);
  approx(G.minDistanceToBoundary(306, [36, 108]), 90);
  assert.equal(G.minDistanceToBoundary(0, []), Infinity);
});
