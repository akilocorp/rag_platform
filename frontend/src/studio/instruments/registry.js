// @language JavaScript (React / JSX)
// @updated   2026-09-07
// @changed   New file: Studio instrument registry, mirroring studio/blocks/registry.js exactly —
//            eager import.meta.glob auto-discovery over *Instrument.jsx, so adding an instrument
//            type is still "drop a file here."
import.meta.glob('./*Instrument.jsx', { eager: true });

const REGISTRY = {};

export function registerInstrument(type, Component) {
  if (REGISTRY[type]) {
    throw new Error(`Instrument type collision: '${type}' is already registered`);
  }
  REGISTRY[type] = Component;
}

export function getInstrumentComponent(type) {
  return REGISTRY[type] || null;
}

export function getRegisteredInstrumentTypes() {
  return Object.keys(REGISTRY);
}
