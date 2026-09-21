'use strict';

/**
 * 设备档位约束（UMD：Node 单测/服务端与浏览器前端共用）。
 *
 * 启用后，旋转角只能取离散档位：
 *
 *   θ_i = 零位偏移 + i × 360° / 档位数（按整圈归一到 [0°, 360°)）
 *
 * 其中档位数为 2～360 的整数。档位集合与可行（或共用）角度段求交后：
 *  - 列出全部可用档位及各自间隙；
 *  - 默认档位沿用“瓶颈间隙最大、角度较小优先”；
 *  - 连续区间有解但无可用档位时，给出距可行段最近的前/后档位及角距离，
 *    以便与“保护区覆盖整圈”的无解场景区分。
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GearPositions = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const FULL = 360;
  const EPS = 1e-7; // 角度比较容差
  const MIN_GEAR_POSITIONS = 2;
  const MAX_GEAR_POSITIONS = 360;

  function mod(n, m) {
    return ((n % m) + m) % m;
  }

  /** 圆上两点最短角距离。 */
  function circDistDeg(a, b) {
    const d = Math.abs(mod(a - b, FULL));
    return Math.min(d, FULL - d);
  }

  /**
   * 校验并归一化档位入参。
   * @param {object|null|undefined} raw {enabled, positions, offsetDeg?}
   * @returns {{ok:true, gear:null|{positions:number, offsetDeg:number}} | {ok:false, error:string}}
   *   未启用（null/缺省/enabled=false）→ gear=null
   */
  function normalizeGear(raw) {
    if (raw === null || raw === undefined) return { ok: true, gear: null };
    if (typeof raw !== 'object') {
      return { ok: false, error: 'gear 必须为对象 {enabled, positions, offsetDeg}' };
    }
    if (!raw.enabled) return { ok: true, gear: null };

    const positions = raw.positions;
    if (
      typeof positions !== 'number' ||
      !Number.isFinite(positions) ||
      !Number.isInteger(positions) ||
      positions < MIN_GEAR_POSITIONS ||
      positions > MAX_GEAR_POSITIONS
    ) {
      return {
        ok: false,
        error: `档位数必须为 ${MIN_GEAR_POSITIONS}～${MAX_GEAR_POSITIONS} 的整数`,
      };
    }

    let offsetDeg = raw.offsetDeg;
    if (offsetDeg === undefined || offsetDeg === null) offsetDeg = 0;
    if (typeof offsetDeg !== 'number' || !Number.isFinite(offsetDeg)) {
      return { ok: false, error: '零位偏移必须为数值 (°)' };
    }
    return { ok: true, gear: { positions, offsetDeg: mod(offsetDeg, FULL) } };
  }

  /** 第 i 个档位的角度（归一化到 [0,360)）。 */
  function gearAngleDeg(index, positions, offsetDeg) {
    return mod((offsetDeg || 0) + (index * FULL) / positions, FULL);
  }

  /** 排序、裁剪并合并紧贴/重叠的 [0,360] 线性片段。 */
  function normalizePieces(pieces) {
    const clamp = (x) => Math.max(0, Math.min(FULL, x));
    const sorted = pieces
      .map(([a, b]) => [clamp(a), clamp(b)])
      .filter(([a, b]) => b - a > EPS)
      .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    const merged = [];
    for (const [a, b] of sorted) {
      const last = merged[merged.length - 1];
      if (last && a <= last[1] + EPS) {
        last[1] = Math.max(last[1], b);
      } else {
        merged.push([a, b]);
      }
    }
    return merged.map(([a, b]) => [a, b >= FULL - EPS ? FULL : b]);
  }

  /**
   * 把圆弧形可行段（{startDeg,endDeg,widthDeg?,wraps?}）转为 [0,360] 线性片段。
   * 整圈返回 [[0,360]]。
   */
  function arcsToPieces(segments) {
    const pieces = [];
    for (const s of segments) {
      const width =
        s.widthDeg !== undefined
          ? s.widthDeg
          : (s.wraps ? s.endDeg + FULL : s.endDeg) - s.startDeg;
      if (width <= EPS) continue;
      if (width >= FULL - EPS) return [[0, FULL]];
      const a = mod(s.startDeg, FULL);
      const b = a + width;
      if (b > FULL + EPS) {
        if (FULL - a > EPS) pieces.push([a, FULL]);
        if (b - FULL > EPS) pieces.push([0, b - FULL]);
      } else {
        pieces.push([a, b]);
      }
    }
    return normalizePieces(pieces);
  }

  function isFullCirclePiece(pieces) {
    return (
      pieces.length === 1 && pieces[0][0] <= EPS && pieces[0][1] >= FULL - EPS
    );
  }

  function pieceContaining(pieces, deg) {
    return pieces.some(([a, b]) => deg >= a - EPS && deg <= b + EPS);
  }

  /** 点 deg 到一组边界点的最短角距离；无边界点返回 Infinity。 */
  function minDistanceToBoundary(deg, boundaryPts) {
    if (!boundaryPts || boundaryPts.length === 0) return Infinity;
    return boundaryPts.reduce(
      (best, p) => Math.min(best, circDistDeg(deg, p)),
      Infinity
    );
  }

  /**
   * 无可用档位时，在每条可行段两端（抬起的整数圈数轴上）找最近的前/后档位。
   * 档位格点 L(k) = offset + k×(360/n)，k 为任意整数；距离按抬起坐标直接计算，
   * 天然处理跨零点。距离相同取角度较小者。
   * @returns {{before:object|null, after:object|null}}
   *   每项 {index, deg, distanceDeg, boundaryDeg}
   */
  function nearestGears(positions, offsetDeg, pieces) {
    const step = FULL / positions;
    let before = null;
    let after = null;

    const consider = (slot, cand) => {
      const cur = slot === 'before' ? before : after;
      if (
        !cur ||
        cand.distanceDeg < cur.distanceDeg - EPS ||
        (Math.abs(cand.distanceDeg - cur.distanceDeg) <= EPS && cand.deg < cur.deg - EPS)
      ) {
        if (slot === 'before') before = cand;
        else after = cand;
      }
    };

    for (const [a, b] of pieces) {
      // 前段位：严格落在 a 之前（间隙 > EPS）的最大格点
      let kb = Math.floor((a - offsetDeg) / step);
      if (a - (offsetDeg + kb * step) <= EPS) kb -= 1;
      const liftedB = offsetDeg + kb * step;
      const db = a - liftedB;
      if (db > EPS && db < FULL) {
        consider('before', {
          index: mod(kb, positions),
          deg: mod(liftedB, FULL),
          distanceDeg: db,
          boundaryDeg: a,
        });
      }

      // 后档位：严格落在 b 之后（间隙 > EPS）的最小格点
      let ka = Math.ceil((b - offsetDeg) / step);
      if (offsetDeg + ka * step - b <= EPS) ka += 1;
      const liftedA = offsetDeg + ka * step;
      const da = liftedA - b;
      if (da > EPS && da < FULL) {
        consider('after', {
          index: mod(ka, positions),
          deg: mod(liftedA, FULL),
          distanceDeg: da,
          boundaryDeg: b,
        });
      }
    }

    return { before, after };
  }

  /**
   * 评估档位与可行段的相交结果。
   * @param {object} p
   * @param {number} p.positions 档位数（已校验的 2～360 整数）
   * @param {number} p.offsetDeg 零位偏移 (°)
   * @param {Array<[number,number]>} p.feasiblePieces [0,360] 线性可行片段
   * @param {(deg:number)=>number} [p.gapAtDeg] 角度→瓶颈间隙（°）；无约束可返回 Infinity
   * @param {(deg:number)=>*} [p.extraAtDeg] 每个可用档位附带的信息（如各规格间隙）
   * @param {string} [p.extraKey] 附带信息挂到档位项上的键名
   */
  function evaluateGears({
    positions,
    offsetDeg,
    feasiblePieces,
    gapAtDeg,
    extraAtDeg,
    extraKey,
  }) {
    const offset = mod(offsetDeg || 0, FULL);
    const pieces = normalizePieces(feasiblePieces || []);
    const full = isFullCirclePiece(pieces);

    const usable = [];
    for (let i = 0; i < positions; i++) {
      const deg = gearAngleDeg(i, positions, offset);
      if (!full && !pieceContaining(pieces, deg)) continue;
      const rawGap = gapAtDeg ? gapAtDeg(deg) : Infinity;
      const item = {
        index: i,
        deg,
        gapDeg: Number.isFinite(rawGap) ? rawGap : null,
      };
      if (extraAtDeg) item[extraKey || 'extra'] = extraAtDeg(deg);
      usable.push(item);
    }

    // 瓶颈间隙最大（无禁用边界 null 视为 +∞），并列角度较小优先
    let best = null;
    for (const item of usable) {
      if (
        !best ||
        (best.gapDeg === null
          ? false
          : item.gapDeg === null || item.gapDeg > best.gapDeg + EPS) ||
        (item.gapDeg === best.gapDeg && item.deg < best.deg - EPS)
      ) {
        best = item;
      }
    }

    const nearest =
      !full && usable.length === 0
        ? nearestGears(positions, offset, pieces)
        : null;

    return {
      enabled: true,
      positions,
      offsetDeg: offset,
      usable,
      best,
      nearest,
    };
  }

  return {
    EPS,
    FULL,
    MIN_GEAR_POSITIONS,
    MAX_GEAR_POSITIONS,
    mod,
    circDistDeg,
    normalizeGear,
    gearAngleDeg,
    normalizePieces,
    arcsToPieces,
    isFullCirclePiece,
    pieceContaining,
    minDistanceToBoundary,
    nearestGears,
    evaluateGears,
  };
});
