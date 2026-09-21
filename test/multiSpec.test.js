'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeSeamAvoidance } = require('../src/seamMath');
const {
  feasibleDegPieces,
  forbiddenDegPieces,
  intersectPieces,
  toCircularArcs,
  circDistDeg,
  gapForSpec,
  computeMultiSpec,
  MIN_SPECS,
  MAX_SPECS,
} = require('../src/multiSpec');

function approx(actual, expected, eps = 1e-7) {
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} !≈ ${expected}`);
}

function arcsToPairs(arcs) {
  return arcs.map((a) => [a.startDeg, a.endDeg]);
}

test('feasibleDegPieces: 跨零可行段拆为两段，整圈/无解正确', () => {
  // C=400 W=20 保护区 [60,120] → 禁用 36°–108°，可行段跨零（108°→36°）
  const r = computeSeamAvoidance(400, 20, [{ start: 60, end: 120 }]);
  assert.deepEqual(feasibleDegPieces(r), [
    [0, 36],
    [108, 360],
  ]);
  assert.deepEqual(forbiddenDegPieces(r), [[36, 108]]);

  const none = computeSeamAvoidance(400, 50, [
    { start: 0, end: 180 },
    { start: 150, end: 400 },
  ]);
  assert.equal(none.noSolution, true);
  assert.deepEqual(feasibleDegPieces(none), []);
  assert.deepEqual(forbiddenDegPieces(none), [[0, 360]]);

  const all = computeSeamAvoidance(400, 20, []);
  assert.deepEqual(feasibleDegPieces(all), [[0, 360]]);
  assert.deepEqual(forbiddenDegPieces(all), []);
});

test('intersectPieces: 普通、跨零与零交集', () => {
  // [0,90]∪[180,360] ∩ [0,45]∪[270,360] = [0,45]∪[270,360]
  assert.deepEqual(
    intersectPieces([
      [
        [0, 90],
        [180, 360],
      ],
      [
        [0, 45],
        [270, 360],
      ],
    ]),
    [
      [0, 45],
      [270, 360],
    ]
  );
  // 仅在一点相接不算共同解
  assert.deepEqual(intersectPieces([[[0, 90]], [[90, 180]]]), []);
  // 与整圈相交保持不变
  assert.deepEqual(intersectPieces([[[0, 360]], [[30, 60]]]), [[30, 60]]);
});

test('toCircularArcs: 零点两侧合并为跨零弧', () => {
  const { arcs } = toCircularArcs([
    [0, 36],
    [108, 360],
  ]);
  assert.equal(arcs.length, 1);
  assert.equal(arcs[0].startDeg, 108);
  assert.equal(arcs[0].endDeg, 36);
  assert.equal(arcs[0].wraps, true);
  approx(arcs[0].widthDeg, 288);

  const inner = toCircularArcs([
    [30, 90],
    [200, 260],
  ]).arcs;
  assert.deepEqual(arcsToPairs(inner), [
    [30, 90],
    [200, 260],
  ]);
  assert.equal(inner.every((a) => !a.wraps), true);

  assert.equal(toCircularArcs([[0, 360]]).full, true);
  assert.deepEqual(toCircularArcs([]).arcs, []);
});

test('circDistDeg: 最短圆周角距离', () => {
  approx(circDistDeg(10, 20), 10);
  approx(circDistDeg(350, 10), 20);
  approx(circDistDeg(0, 180), 180);
});

test('gapForSpec: 到最近禁用边界；无禁用区为 Infinity', () => {
  // 禁用 36°–108°
  const r = computeSeamAvoidance(400, 20, [{ start: 60, end: 120 }]);
  approx(gapForSpec(306, r), 90); // 距 36° 边界走短弧 90°
  approx(gapForSpec(72, r), 36);
  const empty = computeSeamAvoidance(400, 20, []);
  assert.equal(gapForSpec(123, empty), Infinity);
});

test('computeMultiSpec: 参数数量限制 2～8', () => {
  assert.equal(MIN_SPECS, 2);
  assert.equal(MAX_SPECS, 8);
  assert.throws(() => computeMultiSpec([400], 0, []), RangeError);
  assert.throws(
    () => computeMultiSpec([100, 200, 300, 400, 500, 600, 700, 800, 900], 0, []),
    RangeError
  );
});

test('computeMultiSpec: 两规格公共可行段为角度域交集，默认点最大化最小间隙', () => {
  // 共用 W=20、保护区 [60,120]mm：
  //  C=400：禁用 36°–108°，可行 108°→36°（跨零）
  //  C=200：禁用 72°–216°，可行 216°→72°（跨零）
  //  公共可行：216°→36°，宽 180°，中点 306°
  const r = computeMultiSpec([400, 200], 20, [{ start: 60, end: 120 }]);
  assert.equal(r.noSolution, false);
  assert.equal(r.fullCircle, false);
  assert.equal(r.common.length, 1);
  assert.equal(r.common[0].startDeg, 216);
  assert.equal(r.common[0].endDeg, 36);
  assert.equal(r.common[0].wraps, true);
  approx(r.common[0].widthDeg, 180);

  assert.equal(r.best.deg, 306);
  approx(r.best.minGapDeg, 90);
  // 两规格在 306° 处距各自禁用边界均为 90°
  approx(r.best.gaps[0].gapDeg, 90);
  approx(r.best.gaps[1].gapDeg, 90);
  assert.equal(r.best.gaps[0].mm, 340); // 306° 对应 C=400 规格的 340mm
  assert.equal(r.best.gaps[1].mm, 170); // C=200 规格的 170mm
  assert.equal(r.specs.length, 2);
});

test('computeMultiSpec: 公共段等宽并列时默认点取较小角度', () => {
  // 两个相同 C=360 规格：禁用 90°–180° 与 270°–360°
  // 可行段 [0,90]、[180,270] 等宽 → 中点 45° 与 225°，取 45°
  const r = computeMultiSpec(
    [360, 360],
    0,
    [
      { start: 90, end: 180 },
      { start: 270, end: 360 },
    ]
  );
  assert.equal(r.common.length, 2);
  assert.equal(r.best.deg, 45);
  approx(r.best.minGapDeg, 45);
});

test('computeMultiSpec: 所有规格均无禁用区时整圈公共、默认 0°', () => {
  const r = computeMultiSpec([400, 200], 0, []);
  assert.equal(r.fullCircle, true);
  assert.equal(r.best.deg, 0);
  assert.equal(r.best.minGapDeg, null);
  assert.deepEqual(
    r.best.gaps.map((g) => g.gapDeg),
    [null, null]
  );
});

test('computeMultiSpec: 无共同解时报告首次归零的规格与冲突区间', () => {
  // C=360：保护区 [90,180]、[180,360]，W=0 → 禁用 90°–360°，公共候选剩 [0,90]
  // C=180：两保护区在小周长上覆盖整圈 → 该规格本身无解，交集归零
  const r = computeMultiSpec(
    [360, 180],
    0,
    [
      { start: 90, end: 180 },
      { start: 180, end: 360 },
    ]
  );
  assert.equal(r.noSolution, true);
  assert.equal(r.best, null);
  assert.deepEqual(r.common, []);
  assert.ok(r.blocker);
  assert.equal(r.blocker.index, 1);
  assert.equal(r.blocker.circumference, 180);
  // 冲突区间 = 此前公共段 [0,90] ∩ 该规格禁用（整圈）= [0,90]
  assert.deepEqual(arcsToPairs(r.blocker.conflictSegments), [[0, 90]]);
  assert.deepEqual(arcsToPairs(r.blocker.priorCommon), [[0, 90]]);
  assert.deepEqual(arcsToPairs(r.blocker.blockingForbidden), [[0, 360]]);
});

test('computeMultiSpec: 首个规格自身无解时立即归零并标 0', () => {
  const r = computeMultiSpec(
    [400, 300],
    50,
    [
      { start: 0, end: 180 },
      { start: 150, end: 400 },
    ]
  );
  assert.equal(r.noSolution, true);
  assert.equal(r.blocker.index, 0);
  assert.equal(r.blocker.conflictSegments.length, 1);
  assert.equal(r.blocker.conflictSegments[0].full, true);
});

test('computeMultiSpec: 按输入顺序定位首个使交集归零的规格', () => {
  // 前两个 C=360 规格公共段 [0,90]，第三个 C=180 覆盖整圈 → blocker.index=2
  const r = computeMultiSpec(
    [360, 360, 180],
    0,
    [
      { start: 90, end: 180 },
      { start: 180, end: 360 },
    ]
  );
  assert.equal(r.noSolution, true);
  assert.equal(r.blocker.index, 2);
  assert.deepEqual(arcsToPairs(r.blocker.conflictSegments), [[0, 90]]);
});

test('computeMultiSpec: 8 个规格可正常求交，接缝加宽会缩小公共段', () => {
  const Cs = [300, 320, 340, 360, 380, 400, 420, 440];
  const zones = [{ start: 90, end: 150 }];
  const thin = computeMultiSpec(Cs, 0, zones);
  const wide = computeMultiSpec(Cs, 40, zones);
  assert.equal(thin.noSolution, false);
  assert.equal(wide.noSolution, false);
  const thinWidth = Math.max(...thin.common.map((a) => a.widthDeg));
  const wideWidth = Math.max(...wide.common.map((a) => a.widthDeg));
  assert.ok(wideWidth < thinWidth);
});

/* ---------------- 设备档位约束 ---------------- */

const gearOn = (positions, offsetDeg = 0) => ({ positions, offsetDeg });

test('computeMultiSpec: 未启用档位时 gear 为 null', () => {
  const r = computeMultiSpec([400, 200], 20, [{ start: 60, end: 120 }]);
  assert.equal(r.gear, null);
});

test('computeMultiSpec: 档位与公共段相交，默认档最大化各规格瓶颈间隙', () => {
  // 公共可行 216°→36°（宽 180°）；4 档 0/90/180/270：0°、270° 可用
  // 0°：规格0间隙 36°（边界 36）、规格1间隙 72°（边界 72）→ 瓶颈 36°；
  // 270°：规格0间隙 126°、规格1间隙 54°（边界 216）→ 瓶颈 54°，故默认 270°
  const r = computeMultiSpec(
    [400, 200],
    20,
    [{ start: 60, end: 120 }],
    { gear: gearOn(4) }
  );
  assert.equal(r.noSolution, false);
  assert.deepEqual(r.gear.usable.map((u) => u.deg), [0, 270]);
  assert.equal(r.gear.best.deg, 270);
  approx(r.gear.best.gapDeg, 54);
  // 各规格间隙明细
  const gaps270 = r.gear.best.gaps;
  approx(gaps270[0].gapDeg, 126);
  approx(gaps270[1].gapDeg, 54);
  assert.equal(gaps270[0].mm, 300); // 270° × 400/360
  assert.equal(gaps270[1].mm, 150); // 270° × 200/360
  // 0° 档：规格0 36°、规格1 72°
  const gaps0 = r.gear.usable[0].gaps;
  approx(gaps0[0].gapDeg, 36);
  approx(gaps0[1].gapDeg, 72);
  assert.equal(r.gear.nearest, null);
});

test('computeMultiSpec: 偏移旋转档位网格；整圈公共时全部档位可用', () => {
  const r = computeMultiSpec([400, 200], 0, [], { gear: gearOn(6, 30) });
  assert.equal(r.fullCircle, true);
  assert.equal(r.gear.usable.length, 6);
  assert.deepEqual(r.gear.usable.map((u) => u.deg), [30, 90, 150, 210, 270, 330]);
  assert.equal(r.gear.best.deg, 30);
  assert.equal(r.gear.best.gapDeg, null);
  assert.deepEqual(
    r.gear.best.gaps.map((g) => g.gapDeg),
    [null, null]
  );
});

test('computeMultiSpec: 公共段有解但无可用档位时给出最近前/后档位', () => {
  // 两个 C=360 同规格：禁用 [30,180] 与 [207,360]（W=0）
  // 公共可行弧 [0,30]、[180,207]（连续区间有解）
  // 2 档偏移 110°：110°、290° 都在禁用区 → 0 档可用
  const r = computeMultiSpec(
    [360, 360],
    0,
    [
      { start: 30, end: 180 },
      { start: 207, end: 360 },
    ],
    { gear: gearOn(2, 110) }
  );
  assert.equal(r.noSolution, false);
  assert.equal(r.gear.usable.length, 0);
  assert.equal(r.gear.best, null);
  assert.ok(r.gear.nearest);
  // 110° 距可行段起点 180° 为 70°（before）
  assert.equal(r.gear.nearest.before.deg, 110);
  approx(r.gear.nearest.before.distanceDeg, 70);
  assert.equal(r.gear.nearest.before.boundaryDeg, 180);
  // 110°（抬起 470）距跨零可行段末端 30°（抬起 390）为 80°（after）
  assert.equal(r.gear.nearest.after.deg, 110);
  approx(r.gear.nearest.after.distanceDeg, 80);
  assert.equal(r.gear.nearest.after.boundaryDeg, 30);
});

test('computeMultiSpec: 3 档偏移 77° 时仅 317° 档落在公共段内', () => {
  // 公共可行 216°→36°（宽 180°）
  const r = computeMultiSpec(
    [400, 200],
    20,
    [{ start: 60, end: 120 }],
    { gear: gearOn(3, 77) }
  );
  assert.equal(r.noSolution, false);
  assert.deepEqual(r.gear.usable.map((u) => u.deg), [317]);
  assert.equal(r.gear.best.deg, 317);
});

test('computeMultiSpec: 无共同解时档位列出但无默认/最近档', () => {
  const r = computeMultiSpec(
    [360, 180],
    0,
    [
      { start: 90, end: 180 },
      { start: 180, end: 360 },
    ],
    { gear: gearOn(8) }
  );
  assert.equal(r.noSolution, true);
  assert.equal(r.gear.usable.length, 0);
  assert.equal(r.gear.best, null);
  assert.equal(r.gear.nearest, null);
  assert.equal(r.gear.positions, 8);
  assert.equal(r.gear.allGears.length, 8);
});

test('computeMultiSpec: 档位边界点（间隙 0）计为可用', () => {
  // 公共段 216°→36°；2 档偏移 36°：36°（边界，可用）、216°（边界，可用）
  const r = computeMultiSpec(
    [400, 200],
    20,
    [{ start: 60, end: 120 }],
    { gear: gearOn(2, 36) }
  );
  assert.deepEqual(r.gear.usable.map((u) => u.deg), [36, 216]);
  assert.ok(r.gear.usable.every((u) => u.gapDeg === 0));
  assert.equal(r.gear.best.deg, 36); // 并列取小角
});
