// @language JavaScript (React / JSX)
// @updated   2026-09-07
// @changed   New file: split out of registry.js to fix the same production-only circular-import
//            crash documented in studio/blocks/registryStore.js — registry.js eager-imports every
//            *Instrument.jsx file, and every instrument file imports registerInstrument back from
//            registry.js, so in Rollup's production bundle an instrument file's top-level
//            registerInstrument(...) call could run before `const REGISTRY = {}` had executed
//            ("Cannot access 'REGISTRY' before initialization", crashing the whole app). This file
//            holds the actual mutable store and has ZERO imports, so it can never be caught
//            mid-initialization by the cycle.
const REGISTRY = {};

export function registerInstrument(type, { Badge, RespondExtra, ConfigEditor } = {}) {
  if (REGISTRY[type]) {
    throw new Error(`Instrument type collision: '${type}' is already registered`);
  }
  REGISTRY[type] = { Badge, RespondExtra, ConfigEditor };
}

export function getInstrumentBadge(type) {
  return REGISTRY[type]?.Badge || null;
}

export function getInstrumentRespondExtra(type) {
  return REGISTRY[type]?.RespondExtra || null;
}

export function getInstrumentConfigEditor(type) {
  return REGISTRY[type]?.ConfigEditor || null;
}

export function getRegisteredInstrumentTypes() {
  return Object.keys(REGISTRY);
}
