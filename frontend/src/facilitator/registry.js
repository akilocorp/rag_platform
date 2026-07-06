// Registry of facilitator UI widgets.
//
// A "widget" is one interactive UI the facilitator can invoke. A chat message
// records which one it is via `message.facilitator = { widget, data }`; the
// renderer (FacilitatorBlock) reads `widget` and mounts the matching Renderer,
// feeding it `data`.
//
// To add a widget end-to-end:
//   - backend:  src/facilitator/widgets/<id>.py       (the @widget contract + validator)
//   - frontend: src/facilitator/widgets/<id>/index.jsx default-exporting the descriptor
//       { id:'<id>', label, Renderer, interactive }
// The two halves agree on the `id` and the `data` shape. No edits to this file.

const REGISTRY = {};

/** Register a widget descriptor: { id, label, Renderer, interactive }. */
export function registerWidget(def) {
  if (def && def.id) REGISTRY[def.id] = def;
}

/** The descriptor for an id, or null if unknown. */
export function getWidget(id) {
  return REGISTRY[id] || null;
}

/** Lightweight list (id + label) for pickers/menus. */
export function listWidgets() {
  return Object.values(REGISTRY).map(({ id, label }) => ({ id, label }));
}

// Auto-discover self-contained widget subfolders (Vite glob, eager so they
// register at module load). A subfolder with no index file is simply ignored.
const modules = import.meta.glob('./widgets/*/index.{js,jsx}', { eager: true });
for (const mod of Object.values(modules)) {
  if (mod && mod.default) registerWidget(mod.default);
}
