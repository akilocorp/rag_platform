// @language JavaScript (React / JSX)
// @updated   2026-09-07
// @changed   Phase 3: registerInstrument now takes a {Badge, RespondExtra, ConfigEditor} bundle
//            instead of a single component. Badge is the builder-canvas chip (all instruments have
//            one); RespondExtra is optional UI a "renders its own value" instrument shows in the
//            respondent form (e.g. Confidence Slider's range input — Reaction Timer has none, it's
//            purely passive); ConfigEditor is an optional inline control for instrument-specific
//            config the builder needs to expose (e.g. Attention Check's expected-option dropdown).
import.meta.glob('./*Instrument.jsx', { eager: true });

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
