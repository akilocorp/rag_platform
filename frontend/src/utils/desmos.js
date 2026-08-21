// @language  JavaScript
// @updated   2026-08-16
// @changed   Restored the Desmos loader (removed in 3a17e37): lazily injects the v1.7 CDN calculator
//            script once and resolves window.Desmos, so the chart widget's function mode can embed a
//            live GraphingCalculator. Demo API key with a VITE_DESMOS_API_KEY production override.

// Desmos's published demo key — fine for dev. Override in production via a
// VITE_DESMOS_API_KEY build env var so we never hardcode a private key.
const DEMO_API_KEY = 'dcb31709b452b1cf9dc26972add0fda6';
const API_KEY = import.meta.env.VITE_DESMOS_API_KEY || DEMO_API_KEY;
const SCRIPT_SRC = `https://www.desmos.com/api/v1.7/calculator.js?apiKey=${API_KEY}`;

let desmosPromise = null;

// Lazily inject the Desmos API script exactly once and resolve with window.Desmos.
// A Desmos calculator is a live JS widget, so the script has to load before any
// GraphingCalculator() call; callers await this, then mount into a sized <div>.
export function loadDesmos() {
  if (typeof window !== 'undefined' && window.Desmos) return Promise.resolve(window.Desmos);
  if (desmosPromise) return desmosPromise;

  desmosPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-desmos-api]');
    if (existing) {
      if (window.Desmos) { resolve(window.Desmos); return; }
      existing.addEventListener('load', () => resolve(window.Desmos));
      existing.addEventListener('error', () => reject(new Error('Desmos failed to load')));
      return;
    }
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.setAttribute('data-desmos-api', '1');
    script.addEventListener('load', () => resolve(window.Desmos));
    script.addEventListener('error', () => reject(new Error('Desmos failed to load')));
    document.head.appendChild(script);
  });
  return desmosPromise;
}
