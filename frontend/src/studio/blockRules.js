// @language JavaScript
// @updated   2026-10-08
// @changed   New file: the per-block rules both the builder and the runner need — display logic,
//            answer validation (character limits, formats, constant-sum totals), "Other, please
//            specify" values, and how an answer reads when piped into another question. Display
//            logic mirrors backend src/studio/block_settings.py exactly.

export const OTHER_OPTION = 'Other';
export const OTHER_PREFIX = 'Other: ';

// Display-logic operators. `needsValue` drives whether the settings panel
// shows a value picker; `numeric` ops are only offered for scale sources.
export const LOGIC_OPS = [
  { op: 'equals', label: 'is', needsValue: true },
  { op: 'not_equals', label: 'is not', needsValue: true },
  { op: 'gt', label: 'is more than', needsValue: true, numeric: true },
  { op: 'lt', label: 'is less than', needsValue: true, numeric: true },
  { op: 'answered', label: 'is answered', needsValue: false },
  { op: 'not_answered', label: 'is skipped', needsValue: false },
];

export const SCALE_TYPES = ['rating_scale', 'semantic_differential'];

// Whether a value answers a block — mirrors the server's _is_answered, and
// additionally treats an object whose entries are all blank as empty, since
// JSON drops `undefined` entries before the server sees them.
export const isAnswered = (val) => {
  if (val === undefined || val === null) return false;
  if (typeof val === 'string') return val.trim() !== '';
  if (Array.isArray(val)) return val.length > 0;
  if (typeof val === 'object') {
    return Object.values(val).some((v) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === ''));
  }
  return true;
};

// Whether a source block's answer satisfies one display-logic rule.
export const logicMatches = (logic, answer) => {
  const { op } = logic;
  if (op === 'answered') return isAnswered(answer);
  if (op === 'not_answered') return !isAnswered(answer);
  if (!isAnswered(answer)) return false;

  const target = String(logic.value ?? '');
  if (op === 'gt' || op === 'lt') {
    const a = Number(answer);
    const t = Number(target);
    if (!Number.isFinite(a) || !Number.isFinite(t) || target === '') return false;
    return op === 'gt' ? a > t : a < t;
  }

  let equal;
  if (typeof answer === 'object') equal = false;
  else if (target === OTHER_OPTION && typeof answer === 'string' && answer.startsWith(OTHER_PREFIX)) equal = true;
  else if (typeof answer === 'number') equal = answer === Number(target);
  else equal = String(answer) === target;
  return op === 'equals' ? equal : !equal;
};

// Ids of the blocks currently shown, walking in order so a hidden block's
// answer counts as absent for anything downstream of it.
export const visibleBlockIds = (blocks, answers) => {
  const visible = new Set();
  blocks.forEach((blk) => {
    const logic = blk.config?.display_logic;
    if (!logic) { visible.add(blk.id); return; }
    const source = logic.source_block_id;
    const answer = visible.has(source) ? answers[source] : undefined;
    if (logicMatches(logic, answer)) visible.add(blk.id);
  });
  return visible;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The validation message for an answered block whose answer breaks one of the
// block's own response rules, else null. Unanswered blocks are the required
// check's job, not this one's.
export const answerProblem = (block, value) => {
  const cfg = block.config || {};
  if (!isAnswered(value)) return null;

  if (block.type === 'short_text' || block.type === 'long_text') {
    const len = String(value).trim().length;
    if (cfg.min_chars && len < cfg.min_chars) return `Please write at least ${cfg.min_chars} characters.`;
    if (cfg.max_chars && len > cfg.max_chars) return `Please keep this to ${cfg.max_chars} characters or fewer.`;
    if (cfg.input_format === 'number' && !Number.isFinite(Number(String(value).trim()))) return 'Please enter a number.';
    if (cfg.input_format === 'email' && !EMAIL_RE.test(String(value).trim())) return 'Please enter a valid email address.';
  }
  if (block.type === 'single_choice' && typeof value === 'string'
    && value.startsWith(OTHER_PREFIX) && !value.slice(OTHER_PREFIX.length).trim()) {
    return 'Please say what “Other” means for you.';
  }
  if (block.type === 'constant_sum' && cfg.enforce_total) {
    const sum = (cfg.options || []).reduce((acc, opt) => acc + (Number(value[opt]) || 0), 0);
    if (sum !== cfg.total) return `Your numbers need to add up to ${cfg.total} (currently ${sum}).`;
  }
  return null;
};

// An answer as it reads when piped into another question's text. Anything
// without a natural one-line form (a voice transcript) pipes as a dash.
export const formatAnswerForPipe = (value) => {
  if (!isAnswered(value)) return '—';
  if (typeof value === 'string') return value.startsWith(OTHER_PREFIX) ? value.slice(OTHER_PREFIX.length) : value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.every((v) => typeof v === 'string') ? value.join(', ') : '—';
  if (typeof value === 'object') {
    return Object.entries(value).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}: ${v}`).join(', ');
  }
  return '—';
};
