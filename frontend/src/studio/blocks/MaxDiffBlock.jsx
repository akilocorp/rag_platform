// @language JavaScript (React / JSX)
// @updated   2026-09-08
// @changed   New file: the MaxDiff (single-trial best/worst) block — see backend
//            src/studio/blocks/maxdiff.py for why this is one trial, not full rotating MaxDiff.
//            The subset shown is picked once per mount via Math.random (not seeded/reproducible —
//            unlike Option/Subset Randomizer this isn't meant to be stable across reloads, just to
//            avoid every respondent seeing options in the exact same static order).
import React, { useMemo } from 'react';
import { registerBlock } from './registryStore';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

const shuffle = (arr) => {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const MaxDiffBlock = ({ config, mode = 'edit', onChange, value, onAnswer, error }) => {
  const { question = '', options = [], subset_size = 4, required = false } = config || {};

  const updateOption = (idx, val) => {
    const next = [...options];
    next[idx] = val;
    onChange({ ...config, options: next });
  };
  const addOption = () => onChange({ ...config, options: [...options, `Option ${options.length + 1}`] });
  const removeOption = (idx) => onChange({ ...config, options: options.filter((_, i) => i !== idx) });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const subset = useMemo(() => shuffle(options).slice(0, subset_size), []);

  if (mode === 'respond') {
    const most = value?.most;
    const least = value?.least;

    const pick = (field, opt) => {
      const next = { ...value, [field]: opt };
      const other = field === 'most' ? 'least' : 'most';
      if (next[other] === opt) next[other] = undefined;
      onAnswer(next);
    };

    return (
      <div className="p-4">
        <p className="text-sm font-semibold mb-3" style={{ fontFamily: FONT_BODY, color: '#1F1F1F' }}>
          {question} {required && <span style={{ color: '#FA6C43' }}>*</span>}
        </p>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-3 px-1 text-[11px] font-semibold" style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.5)' }}>
            <span className="flex-1" />
            <span className="w-14 text-center">Most</span>
            <span className="w-14 text-center">Least</span>
          </div>
          {subset.map((opt) => (
            <div key={opt} className="flex items-center gap-3 px-1 py-1.5 text-sm" style={{ fontFamily: FONT_BODY, color: '#1F1F1F' }}>
              <span className="flex-1">{opt}</span>
              <span className="w-14 flex justify-center">
                <input type="radio" name={`most`} checked={most === opt} onChange={() => pick('most', opt)} />
              </span>
              <span className="w-14 flex justify-center">
                <input type="radio" name={`least`} checked={least === opt} onChange={() => pick('least', opt)} />
              </span>
            </div>
          ))}
        </div>
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
      <label
        className="flex items-center gap-2 text-xs mt-1"
        style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.6)' }}
      >
        Subset shown per respondent
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
