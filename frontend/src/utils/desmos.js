// Live Desmos calculator embedding for AI chat answers.
//
// renderMarkdown (utils/markdown.js) turns a ```desmos fenced block into a
// placeholder <div class="desmos-embed" data-desmos="<base64 spec>">. Because a
// Desmos calculator is a live JS widget (not static HTML), it can't ride along
// in innerHTML — ChatPage calls mountDesmosGraphs(el) after setting innerHTML to
// turn each placeholder into a real, draggable calculator.

// Desmos's published demo API key — fine for dev. Override in production via a
// VITE_DESMOS_API_KEY build env var so we never hardcode a private key.
const DEMO_API_KEY = 'dcb31709b452b1cf9dc26972add0fda6';
const API_KEY = import.meta.env.VITE_DESMOS_API_KEY || DEMO_API_KEY;
const SCRIPT_SRC = `https://www.desmos.com/api/v1.7/calculator.js?apiKey=${API_KEY}`;

let desmosPromise = null;

// Lazily inject the Desmos script exactly once; resolve with window.Desmos.
function loadDesmos() {
  if (window.Desmos) return Promise.resolve(window.Desmos);
  if (desmosPromise) return desmosPromise;

  desmosPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-desmos-api]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.Desmos));
      existing.addEventListener('error', reject);
      return;
    }
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.setAttribute('data-desmos-api', '1');
    script.addEventListener('load', () => resolve(window.Desmos));
    script.addEventListener('error', reject);
    document.head.appendChild(script);
  });
  return desmosPromise;
}

// Symbols Desmos resolves on its own: graphing/parametric/polar variables and
// built-in constants. Everything else used in an expression needs a definition.
const BUILTIN_VARS = new Set(['x', 'y', 'r', 't', 'e']);
// Bare function names (no backslash) so "abs(x)" / "sin(x)" don't read as vars.
const FUNCS = [
  'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'sin', 'cos', 'tan',
  'csc', 'sec', 'cot', 'log', 'ln', 'exp', 'sqrt', 'abs', 'floor', 'ceil',
  'round', 'sign', 'mod', 'gcd', 'lcm', 'nPr', 'nCr', 'mean', 'median',
  'min', 'max', 'total', 'stdev', 'polygon', 'distance', 'midpoint',
];

// Find single-letter variables an expression references but never defines.
// Returns those letters so the caller can supply a neutral default — this
// guarantees a relation like |x/a|^n+|y/b|^n=1 still renders even if the
// model forgot to give the exponent a value. A false positive only ever adds
// a harmless unused slider; it can never blank an otherwise-valid graph.
function findUndefinedVars(expressions) {
  const defined = new Set();
  expressions.forEach((ex) => {
    const m = /^\s*([a-zA-Z])\s*=/.exec(String(ex));
    if (m) defined.add(m[1]);
  });

  const funcRe = new RegExp(`\\b(${FUNCS.join('|')})\\b`, 'g');
  const referenced = new Set();
  expressions.forEach((ex) => {
    const s = String(ex)
      .replace(/\\left|\\right/g, ' ')   // abs/paren delimiters
      .replace(/\\[a-zA-Z]+/g, ' ')      // latex commands: \frac, \sin, \pi…
      .replace(funcRe, ' ')              // bare function names
      .replace(/^\s*[a-zA-Z]\s*=/, ' '); // a definition's own LHS isn't a ref
    (s.match(/[a-zA-Z]/g) || []).forEach((c) => referenced.add(c));
  });

  return [...referenced].filter((c) => !defined.has(c) && !BUILTIN_VARS.has(c));
}

function decodeSpec(encoded) {
  try {
    return JSON.parse(decodeURIComponent(escape(atob(encoded))));
  } catch {
    return null;
  }
}

// Find every unmounted .desmos-embed placeholder inside `el` and turn it into a
// live calculator. Idempotent: a data-mounted flag stops double-mounting when
// the message re-renders.
export function mountDesmosGraphs(el) {
  if (!el) return;
  const nodes = el.querySelectorAll('.desmos-embed:not([data-mounted])');
  if (!nodes.length) return;

  loadDesmos()
    .then((Desmos) => {
      nodes.forEach((node) => {
        if (node.getAttribute('data-mounted')) return;
        const spec = decodeSpec(node.getAttribute('data-desmos') || '');
        if (!spec || !Array.isArray(spec.expressions)) return;
        node.setAttribute('data-mounted', '1');

        const calc = Desmos.GraphingCalculator(node, {
          expressionsCollapsed: true,
          settingsMenu: false,
          lockViewport: false,
          border: false,
          zoomButtons: true,
        });

        spec.expressions.forEach((expr, i) => {
          try {
            calc.setExpression({ id: `e${i}`, latex: String(expr) });
          } catch {
            /* skip an individual bad expression, keep the rest */
          }
        });

        // Backfill any variable the model referenced but forgot to define
        // (e.g. an undefined exponent) so the graph still renders. Default to
        // 1 — a neutral value that produces a valid curve for most relations.
        findUndefinedVars(spec.expressions).forEach((c) => {
          try {
            calc.setExpression({ id: `auto-${c}`, latex: `${c}=1` });
          } catch {
            /* ignore — Desmos will just flag the original expression */
          }
        });

        if (spec.bounds && typeof spec.bounds === 'object') {
          try {
            calc.setMathBounds(spec.bounds);
          } catch {
            /* invalid bounds → let Desmos auto-fit */
          }
        }

        // Subtle entry: fade/scale the freshly mounted graph into view.
        requestAnimationFrame(() => node.classList.add('desmos-embed--in'));
      });
    })
    .catch(() => {
      // Network/script failure: leave a quiet inline note instead of a blank box.
      nodes.forEach((node) => {
        if (node.getAttribute('data-mounted')) return;
        node.setAttribute('data-mounted', '1');
        node.classList.add('desmos-embed--failed');
        node.textContent = 'Interactive graph could not be loaded.';
      });
    });
}
