// Registry of experiential simulation templates, loaded by id.
//
// Drop a new template file in this folder and add it to TEMPLATES below. Each
// template is validated at module load so a malformed config fails loudly
// (with the offending field path) the moment the app boots, not mid-play.

import { assertValidExperientialConfig } from './schema';
import econOilShock from './econ-oil-shock';

const RAW_TEMPLATES = [econOilShock];

// Validate every template up front and index by meta.id.
const REGISTRY = {};
for (const tpl of RAW_TEMPLATES) {
  assertValidExperientialConfig(tpl, `experiential template "${tpl?.meta?.id ?? '(unknown)'}"`);
  REGISTRY[tpl.meta.id] = tpl;
}

/** Return the validated config for an id, or null if unknown. */
export function getExperientialConfig(id) {
  return REGISTRY[id] || null;
}

/** Lightweight list for pickers / dropdowns. */
export function listExperientialConfigs() {
  return Object.values(REGISTRY).map((t) => ({
    id: t.meta.id,
    title: t.meta.title,
    discipline: t.meta.discipline,
    level: t.meta.level,
    estMinutes: t.meta.estMinutes,
    brief: t.scenario.brief,
  }));
}
