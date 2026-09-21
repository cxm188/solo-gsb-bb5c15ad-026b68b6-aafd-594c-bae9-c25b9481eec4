'use strict';

const path = require('path');
const express = require('express');
const { computeSeamAvoidance } = require('./src/seamMath');
const { computeMultiSpec, MIN_SPECS, MAX_SPECS } = require('./src/multiSpec');
const GearPositions = require('./src/gearPositions');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const MAX_ZONES = 200;

app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));
// 前端直接复用 src 下的 UMD 算法
app.use('/src', express.static(path.join(__dirname, 'src')));

function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

/** 校验设备档位入参，返回归一化档位或错误信息（未启用时为 null）。 */
function validateGear(gear) {
  if (gear === undefined || gear === null) return { gear: null };
  if (typeof gear !== 'object' || Array.isArray(gear)) {
    return { error: 'gear 必须为对象 {enabled, positions, offsetDeg}' };
  }
  if (!gear.enabled) return { gear: null };
  const normalized = GearPositions.normalizeGear(gear);
  if (!normalized.ok) return { error: normalized.error };
  return { gear: normalized.gear };
}

/** 校验共用的接缝宽度与保护区，返回错误信息或 null。 */
function validateSharedInput(seamWidth, zones) {
  if (!isFiniteNumber(seamWidth) || seamWidth < 0) {
    return 'seamWidth 必须为不小于 0 的数值 (mm)';
  }
  if (!Array.isArray(zones) || zones.length > MAX_ZONES) {
    return `zones 必须为数组，且不超过 ${MAX_ZONES} 个`;
  }
  for (const [i, z] of zones.entries()) {
    if (!z || !isFiniteNumber(z.start) || !isFiniteNumber(z.end)) {
      return `zones[${i}] 需要数值类型的 start 与 end (mm)`;
    }
  }
  return null;
}

app.post('/api/compute', (req, res) => {
  const body = req.body || {};
  const { circumference, seamWidth, zones } = body;

  if (!isFiniteNumber(circumference) || circumference <= 0) {
    return res.status(400).json({ error: 'circumference 必须为大于 0 的数值 (mm)' });
  }
  const sharedError = validateSharedInput(seamWidth, zones);
  if (sharedError) return res.status(400).json({ error: sharedError });

  const { gear, error: gearError } = validateGear(body.gear);
  if (gearError) return res.status(400).json({ error: gearError });

  const result = computeSeamAvoidance(circumference, seamWidth, zones, { gear });
  res.json(result);
});

app.post('/api/compute-multi', (req, res) => {
  const body = req.body || {};
  const { circumferences, seamWidth, zones } = body;

  if (
    !Array.isArray(circumferences) ||
    circumferences.length < MIN_SPECS ||
    circumferences.length > MAX_SPECS
  ) {
    return res
      .status(400)
      .json({ error: `circumferences 必须为含 ${MIN_SPECS}～${MAX_SPECS} 个周长的数组 (mm)` });
  }
  for (const [i, C] of circumferences.entries()) {
    if (!isFiniteNumber(C) || C <= 0) {
      return res.status(400).json({ error: `circumferences[${i}] 必须为大于 0 的数值 (mm)` });
    }
  }
  const sharedError = validateSharedInput(seamWidth, zones);
  if (sharedError) return res.status(400).json({ error: sharedError });

  const { gear, error: gearError } = validateGear(body.gear);
  if (gearError) return res.status(400).json({ error: gearError });

  const result = computeMultiSpec(circumferences, seamWidth, zones, { gear });
  res.json(result);
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// 仅在直接启动时监听；被测试 require 时不自动起服务
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`seam-avoidance app listening on http://0.0.0.0:${PORT}`);
  });
}

module.exports = { app };
