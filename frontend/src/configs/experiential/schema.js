// Runtime schema + validator for experiential simulation configs.
//
// These configs drive the structured "experiential" player (a scripted,
// downward-scrolling simulation). They live as typed JS files in this folder
// and are loaded by id via ./index.js. `validateExperientialConfig` is run at
// load time so a malformed template fails loudly with the offending field path
// instead of crashing the player mid-render.

const DIAL_TYPES = ['direction', 'magnitude', 'categorical', 'numeric'];
const ANALYST_MODES = ['scripted', 'generative'];

// Tiny path-aware validator. Each check pushes a `field: message` string into
// `errors`; the caller decides what to do with a non-empty list.
function isStr(v) { return typeof v === 'string'; }
function isNonEmptyStr(v) { return typeof v === 'string' && v.trim().length > 0; }
function isNum(v) { return typeof v === 'number' && !Number.isNaN(v); }
function isBool(v) { return typeof v === 'boolean'; }
function isArr(v) { return Array.isArray(v); }
function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

/**
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateExperientialConfig(config) {
  const errors = [];
  const req = (cond, field, msg) => { if (!cond) errors.push(`${field}: ${msg}`); };

  if (!isObj(config)) {
    return { ok: false, errors: ['(root): config must be an object'] };
  }

  // meta
  const meta = config.meta;
  if (!isObj(meta)) {
    req(false, 'meta', 'must be an object');
  } else {
    req(isNonEmptyStr(meta.id), 'meta.id', 'must be a non-empty string');
    req(isNonEmptyStr(meta.title), 'meta.title', 'must be a non-empty string');
    req(isNonEmptyStr(meta.discipline), 'meta.discipline', 'must be a non-empty string');
    req(isNonEmptyStr(meta.level), 'meta.level', 'must be a non-empty string');
    req(isNum(meta.estMinutes), 'meta.estMinutes', 'must be a number');
  }

  // scenario
  req(isObj(config.scenario) && isNonEmptyStr(config.scenario.brief),
    'scenario.brief', 'must be a non-empty string');

  // analyst
  const analyst = config.analyst;
  if (!isObj(analyst)) {
    req(false, 'analyst', 'must be an object');
  } else {
    req(isNonEmptyStr(analyst.persona), 'analyst.persona', 'must be a non-empty string');
    req(isBool(analyst.stayInCharacter), 'analyst.stayInCharacter', 'must be a boolean');
    req(ANALYST_MODES.includes(analyst.mode), 'analyst.mode', `must be one of ${ANALYST_MODES.join(', ')}`);
  }

  // predictionVariables
  if (!isArr(config.predictionVariables) || config.predictionVariables.length === 0) {
    req(false, 'predictionVariables', 'must be a non-empty array');
  } else {
    config.predictionVariables.forEach((v, i) => {
      const p = `predictionVariables[${i}]`;
      req(isNonEmptyStr(v.id), `${p}.id`, 'required string');
      req(isNonEmptyStr(v.label), `${p}.label`, 'required string');
      req(DIAL_TYPES.includes(v.type), `${p}.type`, `must be one of ${DIAL_TYPES.join(', ')}`);
      if (v.type === 'categorical') {
        req(isArr(v.options) && v.options.length > 0, `${p}.options`, 'categorical dial needs options[]');
      }
      if (v.type === 'numeric') {
        req(isArr(v.range) && v.range.length === 2 && v.range.every(isNum), `${p}.range`, 'numeric dial needs [min, max]');
      }
      req('expected' in v, `${p}.expected`, 'required (string or number)');
      req(isNonEmptyStr(v.intuition), `${p}.intuition`, 'required string');
    });
  }

  // layers
  const layerIds = new Set();
  if (!isArr(config.layers) || config.layers.length === 0) {
    req(false, 'layers', 'must be a non-empty array');
  } else {
    config.layers.forEach((l, i) => {
      const p = `layers[${i}]`;
      req(isNonEmptyStr(l.id), `${p}.id`, 'required string');
      if (isNonEmptyStr(l.id)) layerIds.add(l.id);
      req(isNonEmptyStr(l.name), `${p}.name`, 'required string');
      req(isNonEmptyStr(l.predictPrompt), `${p}.predictPrompt`, 'required string');
      req(isNonEmptyStr(l.changes), `${p}.changes`, 'required string');
      if (!isObj(l.reveal)) {
        req(false, `${p}.reveal`, 'must be an object');
      } else {
        req(isObj(l.reveal.chartSeries), `${p}.reveal.chartSeries`, 'must be an object of name -> number[]');
        if (isObj(l.reveal.chartSeries)) {
          Object.entries(l.reveal.chartSeries).forEach(([k, arr]) => {
            req(isArr(arr) && arr.every(isNum), `${p}.reveal.chartSeries.${k}`, 'must be number[]');
          });
        }
        req(isObj(l.reveal.tableRow), `${p}.reveal.tableRow`, 'must be an object of label -> string');
        req(isNonEmptyStr(l.reveal.narrative), `${p}.reveal.narrative`, 'required string');
      }
    });
  }

  // probes
  const probeIds = new Set();
  const gateRefsFromProbes = [];
  const layerRefsFromProbes = [];
  if (!isArr(config.probes) || config.probes.length === 0) {
    req(false, 'probes', 'must be a non-empty array');
  } else {
    config.probes.forEach((pr, i) => {
      const p = `probes[${i}]`;
      req(isNonEmptyStr(pr.id), `${p}.id`, 'required string');
      if (isNonEmptyStr(pr.id)) probeIds.add(pr.id);
      req(isNonEmptyStr(pr.text), `${p}.text`, 'required string');
      req(isNonEmptyStr(pr.answer), `${p}.answer`, 'required string');
      if (pr.unlocksLayerId != null) layerRefsFromProbes.push([`${p}.unlocksLayerId`, pr.unlocksLayerId]);
      if (pr.establishesGateId != null) gateRefsFromProbes.push([`${p}.establishesGateId`, pr.establishesGateId]);
      if (pr.productiveAfter != null) {
        req(isArr(pr.productiveAfter), `${p}.productiveAfter`, 'must be an array of layer ids');
      }
      if (pr.deadEnd != null) req(isBool(pr.deadEnd), `${p}.deadEnd`, 'must be a boolean');
    });
  }

  // provenanceGates
  const gateIds = new Set();
  if (!isArr(config.provenanceGates)) {
    req(false, 'provenanceGates', 'must be an array');
  } else {
    config.provenanceGates.forEach((g, i) => {
      const p = `provenanceGates[${i}]`;
      req(isNonEmptyStr(g.id), `${p}.id`, 'required string');
      if (isNonEmptyStr(g.id)) gateIds.add(g.id);
      req(isNonEmptyStr(g.claim), `${p}.claim`, 'required string');
      req(isNonEmptyStr(g.untrustedUntilProbeId), `${p}.untrustedUntilProbeId`, 'required string');
      if (isNonEmptyStr(g.untrustedUntilProbeId)) {
        req(probeIds.has(g.untrustedUntilProbeId), `${p}.untrustedUntilProbeId`,
          `references unknown probe "${g.untrustedUntilProbeId}"`);
      }
    });
  }

  // cross-reference integrity (only when the referenced sets parsed cleanly)
  if (layerIds.size > 0) {
    layerRefsFromProbes.forEach(([field, id]) => {
      req(layerIds.has(id), field, `references unknown layer "${id}"`);
    });
    (config.layers || []).forEach((l, i) => {
      if (l.unlockedByProbeId != null) {
        req(probeIds.has(l.unlockedByProbeId), `layers[${i}].unlockedByProbeId`,
          `references unknown probe "${l.unlockedByProbeId}"`);
      }
    });
  }
  if (gateIds.size > 0) {
    gateRefsFromProbes.forEach(([field, id]) => {
      req(gateIds.has(id), field, `references unknown gate "${id}"`);
    });
  }

  // coach
  const coach = config.coach;
  if (!isObj(coach)) {
    req(false, 'coach', 'must be an object');
  } else {
    req(isNum(coach.hintAfterIdleSec), 'coach.hintAfterIdleSec', 'must be a number');
    req(isNum(coach.hintAfterUnproductiveProbes), 'coach.hintAfterUnproductiveProbes', 'must be a number');
    req(isNum(coach.maxHints), 'coach.maxHints', 'must be a number');
    req(isNonEmptyStr(coach.tone), 'coach.tone', 'required string');
  }

  // synthesis
  const synth = config.synthesis;
  if (!isObj(synth)) {
    req(false, 'synthesis', 'must be an object');
  } else {
    req(isNonEmptyStr(synth.task), 'synthesis.task', 'required string');
    req(isNum(synth.wordLimit), 'synthesis.wordLimit', 'must be a number');
    req(isArr(synth.rubric) && synth.rubric.every(isStr), 'synthesis.rubric', 'must be string[]');
  }

  // scoring
  const sc = config.scoring;
  if (!isObj(sc)) {
    req(false, 'scoring', 'must be an object');
  } else {
    ['predictionWeight', 'probeEfficiencyWeight', 'provenanceWeight', 'synthesisWeight'].forEach((k) => {
      req(isNum(sc[k]), `scoring.${k}`, 'must be a number');
    });
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Validate or throw — used at registry load so a bad template surfaces
 * immediately with the offending field path.
 */
export function assertValidExperientialConfig(config, sourceLabel = 'experiential config') {
  const { ok, errors } = validateExperientialConfig(config);
  if (!ok) {
    throw new Error(`Invalid ${sourceLabel}:\n  - ${errors.join('\n  - ')}`);
  }
  return config;
}
