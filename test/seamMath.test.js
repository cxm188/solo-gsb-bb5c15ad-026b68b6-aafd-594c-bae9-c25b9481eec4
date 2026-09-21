'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeZone,
  forbiddenPieces,
  mergeIntervals,
  computeGaps,
  computeSeamAvoidance,
} = require('../src/seamMath');

test('normalizeZone: 普通区间', () => {
  assert.deepEqual(normalizeZone(60, 120, 400), [[60, 120]]);
});

test('normalizeZone: 跨零点区间拆分', () => {
  assert.deepEqual(normalizeZone(350, 30, 400), [
    [350, 400],
    [0, 30],
  ]);
  // 终点恰好落在零点：不产生零长度片段
  assert.deepEqual(normalizeZone(150, 400, 400), [[150, 400]]);
});

test('normalizeZone: 超出周长的输入按周长归一化', () => {
  assert.deepEqual(normalizeZone(410, 450, 400), [[10, 50]]);
  assert.deepEqual(normalizeZone(-30, 10, 400), [
    [370, 400],
    [0, 10],
  ]);
});

test('normalizeZone: 零长度忽略，整圈保留', () => {
  assert.deepEqual(normalizeZone(100, 100, 400), []);
  assert.deepEqual(normalizeZone(0, 400, 400), [[0, 400]]);
});

test('forbiddenPieces: 向左扩展接缝宽度并跨零拆分', () => {
  assert.deepEqual(forbiddenPieces(60, 120, 20, 400), [[40, 120]]);
  assert.deepEqual(forbiddenPieces(10, 50, 20, 400), [
    [390, 400],
    [0, 50],
  ]);
  assert.deepEqual(forbiddenPieces(0, 390, 20, 400), [[0, 400]]);
});

test('mergeIntervals: 合并重叠与相邻区间', () => {
  assert.deepEqual(
    mergeIntervals([
      [10, 50],
      [40, 80],
      [90, 100],
      [100, 120],
    ]),
    [
      [10, 80],
      [90, 120],
    ]
  );
});

test('computeGaps: 环形空隙含跨零段', () => {
  const gaps = computeGaps(
    [
      [0, 30],
      [100, 200],
    ],
    400
  );
  assert.deepEqual(gaps, [
    [30, 100],
    [200, 400], // 跨零空隙线性化为 [200, 400+0]
  ]);
});

test('computeSeamAvoidance: 可行段与默认选择（最远边界、并列取最小角度）', () => {
  // C=400, W=20；保护区 [60,120] → 禁用 [40,120]；[200,260] → 禁用 [180,260]
  // 可行段：[120,180]（宽60）、[260,440]（跨零，宽180）→ 最优为最宽段中点 350
  const r = computeSeamAvoidance(400, 20, [
    { start: 60, end: 120 },
    { start: 200, end: 260 },
  ]);
  assert.equal(r.noSolution, false);
  assert.equal(r.feasible.length, 2);
  assert.equal(r.best.mm, 350);
  assert.equal(r.best.deg, 315);
});

test('computeSeamAvoidance: 等宽可行段并列时取角度最小者', () => {
  // 禁用 [0,100] 与 [200,300] → 可行 [100,200]、[300,400]，等宽，取中点较小者 150
  const r = computeSeamAvoidance(400, 0, [
    { start: 0, end: 100 },
    { start: 200, end: 300 },
  ]);
  assert.equal(r.best.mm, 150);
});

test('computeSeamAvoidance: 跨零点保护区参与计算', () => {
  // 保护区 [350,30]（跨零），W=20 → 禁用片段 [330,400]、[0,30]
  const r = computeSeamAvoidance(400, 20, [{ start: 350, end: 30 }]);
  assert.equal(r.noSolution, false);
  assert.deepEqual(
    r.forbiddenMerged.map((s) => [s.startMm, s.endMm]),
    [
      [0, 30],
      [330, 400],
    ]
  );
  assert.equal(r.feasible.length, 1);
  assert.equal(r.feasible[0].startMm, 30);
  assert.equal(r.feasible[0].endMm, 330);
  assert.equal(r.best.mm, 180);
});

test('computeSeamAvoidance: 无解时给出覆盖整圈的禁用区间链', () => {
  // 两个保护区扩展后相接，覆盖整圈
  const r = computeSeamAvoidance(400, 50, [
    { start: 0, end: 180 },
    { start: 150, end: 400 },
  ]);
  assert.equal(r.noSolution, true);
  assert.equal(r.best, null);
  assert.equal(r.feasible.length, 0);
  assert.equal(r.coveragePct, 100);
  // 区间链：各保护区扩展后的片段依次搭接，覆盖整圈
  assert.deepEqual(
    r.forbiddenChain.map((s) => [s.startMm, s.endMm]),
    [
      [0, 180],
      [100, 400],
      [350, 400],
    ]
  );
  assert.deepEqual(
    r.forbiddenMerged.map((s) => [s.startMm, s.endMm]),
    [[0, 400]]
  );
});

test('computeSeamAvoidance: 无保护区时整圈可行，默认 0°', () => {
  const r = computeSeamAvoidance(400, 20, []);
  assert.equal(r.noSolution, false);
  assert.equal(r.feasible.length, 1);
  assert.equal(r.feasible[0].widthMm, 400);
  assert.equal(r.best.mm, 0);
});

/* ---------------- 设备档位约束 ---------------- */

const gearOn = (positions, offsetDeg = 0) => ({ positions, offsetDeg });

test('computeSeamAvoidance: 未启用档位时 gear 为 null，原结果不变', () => {
  const r = computeSeamAvoidance(400, 20, [{ start: 60, end: 120 }]);
  assert.equal(r.gear, null);
  const r2 = computeSeamAvoidance(400, 20, [{ start: 60, end: 120 }], { gear: null });
  assert.equal(r2.gear, null);
});

test('computeSeamAvoidance: 档位与可行段相交并按瓶颈间隙选默认档', () => {
  // C=400 W=20：禁用 [40,120] 与 [180,260]（即 36°–108°、162°–234°）
  // 8 档（0,45,90,135,180,225,270,315）：可用 0°、135°、270°、315°
  const r = computeSeamAvoidance(
    400,
    20,
    [
      { start: 60, end: 120 },
      { start: 200, end: 260 },
    ],
    { gear: gearOn(8) }
  );
  assert.equal(r.gear.positions, 8);
  assert.equal(r.gear.offsetDeg, 0);
  assert.deepEqual(r.gear.usable.map((u) => u.deg), [0, 135, 270, 315]);
  // 各档间隙：0°→36、135°→27、270°→36、315°→81
  assert.deepEqual(r.gear.usable.map((u) => Math.round(u.gapDeg)), [36, 27, 36, 81]);
  assert.deepEqual(r.gear.usable.map((u) => Math.round(u.mm)), [0, 150, 300, 350]);
  assert.equal(r.gear.best.deg, 315);
  assert.equal(r.gear.best.mm, 350);
  assert.equal(r.gear.nearest, null);
});

test('computeSeamAvoidance: 零位偏移旋转档位网格', () => {
  // 偏移 22.5°，8 档：22.5,67.5,...,337.5；禁用 36°–108°
  // 可用档位中 247.5° 距边界最远（247.5−108=139.5）
  const r = computeSeamAvoidance(
    400,
    20,
    [{ start: 60, end: 120 }],
    { gear: gearOn(8, 22.5) }
  );
  assert.equal(r.gear.offsetDeg, 22.5);
  assert.ok(!r.gear.usable.some((u) => u.deg > 36 - 1e-6 && u.deg < 108 + 1e-6));
  assert.ok(Math.abs(r.gear.best.deg - 247.5) < 1e-9);
});

test('computeSeamAvoidance: 间隙并列时默认取角度较小档位', () => {
  // 禁用 [0,90°] 与 [180°,270°]（W=0, C=400）→ 可行 [90,180]、[270,360]
  // 4 档 0/90/180/270：90、180、270 为边界档（间隙 0）→ 并列取 90°
  const r = computeSeamAvoidance(
    400,
    0,
    [
      { start: 0, end: 100 },
      { start: 200, end: 300 },
    ],
    { gear: gearOn(4) }
  );
  assert.deepEqual(r.gear.usable.map((u) => u.deg), [90, 180, 270]);
  assert.equal(r.gear.best.deg, 90);

  // 2 档偏移 50°：50° 与 230° 都在禁用区 → 无可用档位但连续有解
  const r2 = computeSeamAvoidance(
    400,
    0,
    [
      { start: 0, end: 100 },
      { start: 200, end: 300 },
    ],
    { gear: gearOn(2, 50) }
  );
  assert.equal(r2.noSolution, false);
  assert.equal(r2.gear.usable.length, 0);
  assert.equal(r2.gear.best, null);
  assert.ok(r2.gear.nearest);
  // 50° 距可行段起点 90° 为 40°（before）；50°（抬起 410）距可行段末端 360 为 50°（after）
  assert.equal(r2.gear.nearest.before.deg, 50);
  assert.ok(Math.abs(r2.gear.nearest.before.distanceDeg - 40) < 1e-9);
  assert.equal(r2.gear.nearest.before.boundaryDeg, 90);
  assert.equal(r2.gear.nearest.after.deg, 50);
  assert.ok(Math.abs(r2.gear.nearest.after.distanceDeg - 50) < 1e-9);
  assert.equal(r2.gear.nearest.after.boundaryDeg, 360);
});

test('computeSeamAvoidance: 整圈可行时全部档位可用，无禁用边界', () => {
  const r = computeSeamAvoidance(400, 20, [], { gear: gearOn(12, 15) });
  assert.equal(r.gear.usable.length, 12);
  assert.equal(r.gear.best.deg, 15);
  assert.equal(r.gear.best.gapDeg, null);
  assert.equal(r.gear.usable[0].mm, (15 / 360) * 400);
});

test('computeSeamAvoidance: 整圈禁用时给出理论档位但无默认/最近档', () => {
  const r = computeSeamAvoidance(
    400,
    50,
    [
      { start: 0, end: 180 },
      { start: 150, end: 400 },
    ],
    { gear: gearOn(6) }
  );
  assert.equal(r.noSolution, true);
  assert.equal(r.gear.usable.length, 0);
  assert.equal(r.gear.best, null);
  assert.equal(r.gear.nearest, null);
  assert.equal(r.gear.positions, 6);
  assert.equal(r.gear.allGears.length, 6);
  assert.deepEqual(r.gear.allGears.map((x) => x.deg), [0, 60, 120, 180, 240, 300]);
});
