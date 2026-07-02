// Validator for the Shock World lab config. Mirrors the shape produced by the
// backend method (src/experiential/methods/shock_world.py) + its _normalize().
// Returns { ok, errors } — the same contract the registry expects.

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isQuestion(q) {
  return q && isNonEmptyString(q.text) && Array.isArray(q.options) && q.options.length >= 2;
}

export function validate(config) {
  const errors = [];
  const c = config || {};

  if (c.method !== 'shock-world') errors.push("method must be 'shock-world'");
  if (!c.meta || typeof c.meta !== 'object') errors.push('meta is missing');
  if (!c.scenario || !isNonEmptyString(c.scenario.brief)) errors.push('scenario.brief is missing');

  if (!Array.isArray(c.countries) || c.countries.length === 0) {
    errors.push('countries must be a non-empty list');
  }

  if (!Number.isInteger(c.maxRounds) || c.maxRounds < 1) {
    errors.push('maxRounds must be an integer ≥ 1');
  }

  if (!Array.isArray(c.targetIntuitions) || c.targetIntuitions.length === 0) {
    errors.push('targetIntuitions must be a non-empty list');
  } else {
    c.targetIntuitions.forEach((t, i) => {
      if (!t || !isNonEmptyString(t.label)) errors.push(`targetIntuitions[${i}].label is missing`);
      if (!isQuestion(t?.seedQuestion)) errors.push(`targetIntuitions[${i}].seedQuestion is missing or malformed`);
    });
  }

  if (!c.gate || !isNonEmptyString(c.gate.prompt) || !Array.isArray(c.gate.options) || c.gate.options.length < 2) {
    errors.push('gate must have a prompt and at least two options');
  }

  if (!c.scoring || typeof c.scoring !== 'object') errors.push('scoring is missing');

  return { ok: errors.length === 0, errors };
}
