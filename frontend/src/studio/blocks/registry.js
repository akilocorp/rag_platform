// @language JavaScript (React / JSX)
// @updated   2026-09-07
// @changed   Fixed a production-crash bug: this file used to hold the REGISTRY object directly,
//            which created a circular import with every *Block.jsx file (they import
//            registerBlock from here; this file eager-imports them). See registryStore.js's
//            header for the full mechanism — the fix is just moving the actual store there, a
//            module with no imports so it can never be caught mid-initialization by the cycle.
//            This file now only triggers discovery and re-exports the public read API.
import.meta.glob('./*Block.jsx', { eager: true });

export { getBlockComponent, getRegisteredTypes } from './registryStore';
