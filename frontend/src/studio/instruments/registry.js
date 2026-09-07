// @language JavaScript (React / JSX)
// @updated   2026-09-07
// @changed   Fixed the same production-crash bug documented in studio/blocks/registry.js: this
//            file used to hold the REGISTRY object directly, circularly importing every
//            *Instrument.jsx file. The actual store now lives in registryStore.js (no imports, so
//            it can't be caught mid-initialization); this file only triggers discovery and
//            re-exports the public read API.
import.meta.glob('./*Instrument.jsx', { eager: true });

export {
  getInstrumentBadge,
  getInstrumentRespondExtra,
  getInstrumentConfigEditor,
  getRegisteredInstrumentTypes,
} from './registryStore';
