// @language JavaScript (React / JSX)
// @updated   2026-09-09
// @changed   Now multi-round, following the facilitator chat's flashcard widget's own pattern
//            (frontend/src/facilitator/widgets/flashcard/index.jsx) for moving between cards:
//            key the round's content on its index so React remounts (and replays the entrance
//            animation) on every advance, rather than patching the existing node in place. Unlike
//            flashcard's explicit Prev/Next buttons, MaxDiff auto-advances a short beat after both
//            Most and Least are picked for the current round — "respond, then shift to the next
//            round," not manual navigation. Answer value is now an array of per-round
//            `{options, most, least}` results; see backend src/studio/blocks/maxdiff.py.
import React, { useEffect, useMemo, useState } from 'react';
import { FaCheckCircle } from 'react-icons/fa';
import { registerBlock } from './registryStore';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";
const ROUND_ADVANCE_DELAY_MS = 550;

const shuffle = (arr) => {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const MaxDiffBlock = ({ config, mode = 'edit', onChange, value, onAnswer, error }) => {
  const {
    question = '', options = [], subset_size = 4, num_rounds = 3, required = false,
  } = config || {};

  const updateOption = (idx, val) => {
    const next = [...options];
    next[idx] = val;
    onChange({ ...config, options: next });
  };
  const addOption = () => onChange({ ...config, options: [...options, `Option ${options.length + 1}`] });
  const removeOption = (idx) => onChange({ ...config, options: options.filter((_, i) => i !== idx) });

  // Every round's subset is picked once per mount, each independently shuffled
  // (not a balanced-incomplete-block design — an option can repeat across
  // rounds — and not seeded/reproducible, same reasoning as the single-trial
  // version this replaced: this is variety, not a stability guarantee).
  const rounds = useMemo(() => (
    Array.from({ length: num_rounds }, () => shuffle(options).slice(0, Math.min(subset_size, options.length)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), []);

  const roundResults = Array.isArray(value) ? value : [];
  const currentRoundIndex = roundResults.length;
  const isComplete = currentRoundIndex >= rounds.length;
  const currentRound = rounds[currentRoundIndex];

  const [pendingMost, setPendingMost] = useState(undefined);
  const [pendingLeast, setPendingLeast] = useState(undefined);

  // Auto-advance a short beat after both picks land for this round — the
  // flashcard widget advances on an explicit Next click, but MaxDiff's
  // "response" IS the advance trigger, so there's no button to wait on.
  useEffect(() => {
    if (mode !== 'respond' || !currentRound) return undefined;
    if (pendingMost === undefined || pendingLeast === undefined) return undefined;
    const timer = setTimeout(() => {
      onAnswer([...roundResults, { options: currentRound, most: pendingMost, least: pendingLeast }]);
      setPendingMost(undefined);
      setPendingLeast(undefined);
    }, ROUND_ADVANCE_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMost, pendingLeast]);

  if (mode === 'respond') {
    const pick = (field, opt) => {
      const otherVal = field === 'most' ? pendingLeast : pendingMost;
      const setOther = field === 'most' ? setPendingLeast : setPendingMost;
      (field === 'most' ? setPendingMost : setPendingLeast)(opt);
      if (otherVal === opt) setOther(undefined);
    };

    return (
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold" style={{ fontFamily: FONT_BODY, color: '#1F1F1F' }}>
            {question} {required && <span style={{ color: '#FA6C43' }}>*</span>}
          </p>
          <span
            className="text-[11px] font-semibold shrink-0 ml-3 tabular-nums"
            style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.4)' }}
          >
            {isComplete ? `${rounds.length}/${rounds.length}` : `Round ${currentRoundIndex + 1}/${rounds.length}`}
          </span>
        </div>

        {isComplete ? (
          <div key="done" className="flex items-center gap-2 py-3 animate-chip-in" style={{ color: '#1E7A3D' }}>
            <FaCheckCircle size={14} />
            <span className="text-sm font-medium" style={{ fontFamily: FONT_BODY }}>All rounds complete.</span>
          </div>
        ) : (
          <div key={currentRoundIndex} className="flex flex-col gap-1.5 animate-chip-in">
            <div
              className="flex items-center gap-3 px-1 text-[11px] font-semibold"
              style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.5)' }}
            >
              <span className="flex-1" />
              <span className="w-14 text-center">Most</span>
              <span className="w-14 text-center">Least</span>
            </div>
            {currentRound.map((opt) => (
              <div
                key={opt}
                className="flex items-center gap-3 px-1 py-1.5 text-sm"
                style={{ fontFamily: FONT_BODY, color: '#1F1F1F' }}
              >
                <span className="flex-1">{opt}</span>
                <span className="w-14 flex justify-center">
                  <input
                    type="radio"
                    name={`most-${currentRoundIndex}`}
                    checked={pendingMost === opt}
                    onChange={() => pick('most', opt)}
                  />
                </span>
                <span className="w-14 flex justify-center">
                  <input
                    type="radio"
                    name={`least-${currentRoundIndex}`}
                    checked={pendingLeast === opt}
                    onChange={() => pick('least', opt)}
                  />
                </span>
              </div>
            ))}
          </div>
        )}
        {error && <p className="text-xs mt-2" style={{ color: '#E5484D', fontFamily: FONT_BODY }}>{error}</p>}
      </div>
    );
  }

  return (
    <div className="p-4 flex flex-col gap-2">
      <input
        type="text"
        value={question}
        onChange={(e) => onChange({ ...config, question: e.target.value })}
        placeholder="Question text"
        className="w-full px-3 py-2 rounded-lg border text-sm font-semibold"
        style={{ borderColor: 'rgba(31,31,31,0.15)', fontFamily: FONT_BODY, color: '#1F1F1F' }}
      />
      <div className="flex flex-col gap-1.5 mt-1">
        {options.map((opt, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <input
              type="text"
              value={opt}
              onChange={(e) => updateOption(idx, e.target.value)}
              className="flex-1 px-2.5 py-1.5 rounded-md border text-sm"
              style={{ borderColor: 'rgba(31,31,31,0.1)', fontFamily: FONT_BODY, color: '#1F1F1F' }}
            />
            {options.length > 2 && (
              <button
                type="button"
                onClick={() => removeOption(idx)}
                className="text-xs px-1.5"
                style={{ color: 'rgba(31,31,31,0.4)' }}
                aria-label="Remove option"
              >
                &times;
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={addOption}
          className="self-start text-xs font-semibold mt-1"
          style={{ color: '#FA6C43', fontFamily: FONT_BODY }}
        >
          + Add option
        </button>
      </div>
      <div className="flex items-center gap-4">
        <label
          className="flex items-center gap-2 text-xs mt-1"
          style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.6)' }}
        >
          Subset per round
          <input
            type="number"
            min={2}
            max={Math.max(options.length, 2)}
            value={subset_size}
            onChange={(e) => onChange({ ...config, subset_size: Number(e.target.value) })}
            className="w-14 px-2 py-1 rounded-md border text-sm"
            style={{ borderColor: 'rgba(31,31,31,0.15)', fontFamily: FONT_BODY, color: '#1F1F1F' }}
          />
        </label>
        <label
          className="flex items-center gap-2 text-xs mt-1"
          style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.6)' }}
        >
          Rounds
          <input
            type="number"
            min={1}
            max={10}
            value={num_rounds}
            onChange={(e) => onChange({ ...config, num_rounds: Number(e.target.value) })}
            className="w-14 px-2 py-1 rounded-md border text-sm"
            style={{ borderColor: 'rgba(31,31,31,0.15)', fontFamily: FONT_BODY, color: '#1F1F1F' }}
          />
        </label>
      </div>
      <label
        className="flex items-center gap-2 text-xs mt-1"
        style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.6)' }}
      >
        <input
          type="checkbox"
          checked={required}
          onChange={(e) => onChange({ ...config, required: e.target.checked })}
        />
        Required
      </label>
    </div>
  );
};

registerBlock('maxdiff', MaxDiffBlock);

export default MaxDiffBlock;
