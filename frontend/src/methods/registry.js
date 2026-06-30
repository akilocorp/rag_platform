// Registry of experiential pedagogical methods.
//
// A "method" is one teaching pedagogy with its OWN schema (validator) and its
// OWN player. A lab records which one it is via `config.method`; the player page
// reads that and mounts the matching validator + Runner.
//
// Two ways a method registers:
//   1. Drop a SUBFOLDER here that default-exports { id, label, validate, Runner }
//      — it is auto-discovered below, no edits to this file.
//   2. registerMethod({ ... }) called at import time. Used by the built-in
//      `predict-reveal`, whose large player still lives in
//      pages/ExperientialPage.jsx; it can be relocated into a subfolder later
//      with no change to this seam.
//
// To add a brand-new pedagogy end-to-end:
//   - backend: src/experiential/methods/<id>.py  (the generation prompt; set its
//     `schema='<id>'` so generated labs are stamped config.method = '<id>')
//   - frontend: src/methods/<id>/index.{js,jsx}  default-exporting the descriptor
//     { id:'<id>', label, validate, Runner }

export const DEFAULT_METHOD_ID = 'predict-reveal';

const REGISTRY = {};

/** Register a method descriptor: { id, label, validate, Runner }. */
export function registerMethod(def) {
  if (def && def.id) REGISTRY[def.id] = def;
}

/** The descriptor for an id, or null if unknown. */
export function getMethod(id) {
  return REGISTRY[id] || null;
}

/** Lightweight list for pickers. */
export function listMethods() {
  return Object.values(REGISTRY).map(({ id, label }) => ({ id, label }));
}

// Auto-discover self-contained method subfolders (Vite glob, eager so they
// register at module load). A subfolder with no index file is simply ignored.
const modules = import.meta.glob('./*/index.{js,jsx}', { eager: true });
for (const mod of Object.values(modules)) {
  if (mod && mod.default) registerMethod(mod.default);
}
