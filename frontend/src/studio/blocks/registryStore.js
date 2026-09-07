// @language JavaScript (React / JSX)
// @updated   2026-09-07
// @changed   New file: split out of registry.js to fix a production-only crash. registry.js does
//            an eager import.meta.glob of every *Block.jsx file, and every block file imports
//            registerBlock back from registry.js — a circular import. In Rollup's production
//            bundle (unlike Vite's dev server), that circularity meant a block file's top-level
//            registerBlock(...) call could run before registry.js's own `const REGISTRY = {}` had
//            executed, throwing "Cannot access 'REGISTRY' before initialization" and crashing the
//            entire bundle (confirmed by reproducing the exact failure in plain Node ESM). This
//            file holds the actual mutable store and has ZERO imports of its own, so it always
//            finishes initializing before anything can call into it — no cycle possible.
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
