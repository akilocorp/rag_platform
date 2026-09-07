// @language JavaScript (React / JSX)
// @updated   2026-09-07
// @changed   New file: Studio block registry. Auto-discovers every sibling *Block.jsx module via
//            an eager import.meta.glob (same technique frontend/src/guide/content.js uses for its
//            pages) — each block file calls registerBlock() as a load-time side effect, so adding
//            a block type is "drop a file here," mirroring the backend's @block auto-discovery.
import.meta.glob('./*Block.jsx', { eager: true });

const REGISTRY = {};

export function registerBlock(type, Component) {
  if (REGISTRY[type]) {
    throw new Error(`Block type collision: '${type}' is already registered`);
  }
  REGISTRY[type] = Component;
}

export function getBlockComponent(type) {
  return REGISTRY[type] || null;
}

export function getRegisteredTypes() {
  return Object.keys(REGISTRY);
}
