// Deterministic chart-accuracy guard.
//
// Experiential charts plot "% deviation from baseline" series. The generation
// model sometimes draws an ACCUMULATING LEVEL (capital per worker, productivity,
// output per worker…) with the wrong trajectory — e.g. capital-per-worker sloping
// DOWN when the lab itself says it rises. A prompt can only *ask* the model to get
// this right; this guard *guarantees* it in code, right before the chart renders,
// so even already-saved labs are corrected on load (no regeneration needed).
//
// What it deliberately does NOT touch:
//   - rates / growth / flows (a decelerating growth line SHOULD fall), and
//   - shock-response (impulse) variables, e.g. an oil-shock GDP path that
//     legitimately dips then recovers ([-0.6,-1.2,-1.6,-1.8,-1.4,-0.9,-0.5,-0.2]).
// Only variables that are confidently accumulating LEVELS are forced monotonic,
// and only in the direction the lab itself declares (predictionVariables[].expected
// — never a hardcoded "levels go up" assumption).

// A name with any of these reads as a rate/flow/derivative → never a monotone level.
const RATE_TERMS = [
  'growth', 'rate', 'change', 'delta', 'Δ', 'inflation', 'return', 'yield',
  'spread', 'velocity', 'pace', 'per year', 'per quarter', '%',
];
// A name with any of these (and no rate term) reads as an accumulating stock/level.
const LEVEL_TERMS = [
  'per worker', 'per-worker', 'per capita', 'per-capita', 'capital', 'stock',
  'productivity', 'output per', 'gdp per', 'income per', 'wealth', 'reserves',
  'accumulat', 'k/l',
];

// Is this chart variable an accumulating level (monotone) vs a flow/rate/impulse?
// An explicit `kind` from the generator wins; otherwise a conservative name test
// that defaults to "not a level" (i.e. leave it alone) when unsure.
function isAccumulatingLevel(key, label, explicitKind) {
  if (explicitKind === 'level') return true;
  if (explicitKind === 'flow' || explicitKind === 'rate') return false;
  const text = `${key || ''} ${label || ''}`.toLowerCase();
  if (RATE_TERMS.some((t) => text.includes(t))) return false;
  return LEVEL_TERMS.some((t) => text.includes(t));
}

// Reorder the existing values into a monotone path — preserves the model's own
// magnitudes, just guarantees the trajectory direction. Idempotent.
function monotone(values, direction) {
  const sorted = [...values].sort((a, b) => a - b); // ascending
  return direction === 'down' ? sorted.reverse() : sorted;
}

/**
 * Return a config whose accumulating-level chart series are guaranteed to trend
 * in the direction the lab declares. Pure: returns a new object on change, never
 * mutates the input; returns the input untouched when nothing needs fixing.
 */
export function enforceChartAccuracy(config) {
  if (!config || !Array.isArray(config.layers)) return config;

  const pvById = {};
  for (const v of (config.predictionVariables || [])) {
    if (v && v.id) pvById[v.id] = v;
  }

  const baseSeries = config.layers[0]?.reveal?.chartSeries;
  if (!baseSeries || typeof baseSeries !== 'object') return config;

  // Decide, per chart key, whether it's a level and which way it must trend.
  const dirByKey = {};
  for (const key of Object.keys(baseSeries)) {
    const pv = pvById[key];
    if (!isAccumulatingLevel(key, pv?.label, pv?.kind)) continue;
    dirByKey[key] = pv?.expected === 'down' ? 'down' : 'up'; // level defaults to rising
  }
  const keys = Object.keys(dirByKey);
  if (!keys.length) return config;

  let changed = false;
  const layers = config.layers.map((lyr) => {
    const cs = lyr?.reveal?.chartSeries;
    if (!cs || typeof cs !== 'object') return lyr;
    let layerChanged = false;
    const nextCs = { ...cs };
    for (const key of keys) {
      const arr = cs[key];
      if (!Array.isArray(arr) || arr.length < 2 || !arr.every((n) => typeof n === 'number')) continue;
      const fixed = monotone(arr, dirByKey[key]);
      if (fixed.some((n, idx) => n !== arr[idx])) {
        nextCs[key] = fixed;
        layerChanged = true;
      }
    }
    if (!layerChanged) return lyr;
    changed = true;
    return { ...lyr, reveal: { ...lyr.reveal, chartSeries: nextCs } };
  });

  return changed ? { ...config, layers } : config;
}
