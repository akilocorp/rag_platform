// @language JavaScript
// @updated   2026-10-08
// @changed   New file: groups the builder rail's blocks and instruments by what they do (scales,
//            choice, open text, ranking, ...) and gives each block a one-line description, so the
//            rail shows a handful of categories instead of every type at once.
import {
  FaAlignLeft, FaSlidersH, FaDotCircle, FaFont, FaListOl, FaMicrophone, FaShapes,
  FaShieldAlt, FaRandom, FaStopwatch, FaLink, FaBrain, FaWaveSquare,
} from 'react-icons/fa';

// Rail order = this order. A type the backend registers but this map doesn't
// know yet lands in a trailing "More" group, so a new block still shows up.
export const BLOCK_CATEGORIES = [
  { key: 'content', label: 'Content', icon: FaAlignLeft, types: ['rich_text'] },
  { key: 'scales', label: 'Scales', icon: FaSlidersH, types: ['rating_scale', 'semantic_differential', 'yes_no'] },
  { key: 'choice', label: 'Choice', icon: FaDotCircle, types: ['single_choice'] },
  { key: 'text', label: 'Open text', icon: FaFont, types: ['short_text', 'long_text'] },
  { key: 'ranking', label: 'Ranking & trade-offs', icon: FaListOl, types: ['forced_rank', 'maxdiff', 'constant_sum', 'card_sort'] },
  { key: 'ai', label: 'AI & conversation', icon: FaMicrophone, types: ['voice_conversation'] },
];

export const INSTRUMENT_CATEGORIES = [
  { key: 'quality', label: 'Quality checks', icon: FaShieldAlt, types: ['attention_check', 'instructed_response', 'speeder_flag', 'read_time_gate'] },
  { key: 'randomize', label: 'Randomization', icon: FaRandom, types: ['option_randomizer', 'subset_randomizer'] },
  { key: 'timing', label: 'Timing & confidence', icon: FaStopwatch, types: ['reaction_timer', 'confidence_slider'] },
  { key: 'personalize', label: 'Personalization', icon: FaLink, types: ['piped_text'] },
  { key: 'ai', label: 'AI analysis', icon: FaBrain, types: ['llm_rubric_grader', 'cross_answer_inconsistency', 'comprehension_paraphrase_check', 'ai_devils_advocate', 'adaptive_followup_probe'] },
  { key: 'voice', label: 'Voice signals', icon: FaWaveSquare, types: ['vocal_emotion_trace', 'sentiment_drift', 'hesitation_detector'] },
];

export const BLOCK_DESCRIPTIONS = {
  rich_text: 'Text or instructions between questions',
  rating_scale: 'Likert or 1–n numeric rating',
  semantic_differential: 'Rate between two opposite adjectives',
  yes_no: 'A single yes-or-no answer',
  single_choice: 'Pick one answer from a list',
  short_text: 'A one-line written answer',
  long_text: 'A paragraph-length written answer',
  forced_rank: 'Put every item in order',
  maxdiff: 'Pick best and worst across rounds',
  constant_sum: 'Split a fixed total across options',
  card_sort: 'Sort items into categories',
  voice_conversation: 'A live spoken conversation with an AI',
};

// Specs grouped into [{...category, specs}], empty categories dropped and
// unknown types collected under "More".
export const groupSpecs = (specs, categories) => {
  const known = new Set(categories.flatMap((c) => c.types));
  const byType = Object.fromEntries(specs.map((s) => [s.type, s]));
  const groups = categories
    .map((c) => ({ ...c, specs: c.types.map((t) => byType[t]).filter(Boolean) }))
    .filter((c) => c.specs.length > 0);
  const rest = specs.filter((s) => !known.has(s.type));
  if (rest.length > 0) groups.push({ key: 'more', label: 'More', icon: FaShapes, types: [], specs: rest });
  return groups;
};
