// @language JavaScript (React / JSX)
// @updated   2026-10-08
// @changed   Edit mode now renders only the scale settings (adjective pair + points) for the
//            builder's settings panel — the question and Required moved there; respond mode uses the
//            shared QuestionHeader.
// Prior: New file: the Semantic Differential block — config shape matches backend
//            src/studio/blocks/semantic_differential.py exactly. Respond UI mirrors Rating Scale's
//            row of numbered buttons, flanked by the two adjective labels instead of standing alone.
import React from 'react';
import { registerBlock } from './registryStore';
import {
  FONT_BODY, QuestionHeader, NumberField, TextField, SettingsStack,
} from './blockParts';

const SemanticDifferentialBlock = ({ config, mode = 'edit', onChange, blockId, value, onAnswer, error }) => {
  const { left_label = 'Weak', right_label = 'Strong', points = 7 } = config || {};
  const scale = Array.from({ length: points }, (_, i) => i + 1);

  if (mode === 'respond') {
    return (
      <div className="p-4">
        <QuestionHeader config={config} />
        <div className="flex items-center gap-3">
          <span className="text-xs shrink-0" style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.6)' }}>{left_label}</span>
          <div className="flex gap-1.5 flex-1 justify-center">
            {scale.map((n) => (
              <button
                key={n}
                type="button"
                name={blockId}
                onClick={() => onAnswer(n)}
                className="w-8 h-8 rounded-full border text-xs font-semibold transition-colors"
                style={{
                  fontFamily: FONT_BODY,
                  borderColor: value === n ? '#FA6C43' : 'rgba(31,31,31,0.15)',
                  backgroundColor: value === n ? '#FA6C43' : 'transparent',
                  color: value === n ? '#FFFFFF' : '#1F1F1F',
                }}
                aria-pressed={value === n}
              >
                {n}
              </button>
            ))}
          </div>
          <span className="text-xs shrink-0" style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.6)' }}>{right_label}</span>
        </div>
        {error && <p className="text-xs mt-2" style={{ color: '#E5484D', fontFamily: FONT_BODY }}>{error}</p>}
      </div>
    );
  }

  return (
    <SettingsStack>
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Left adjective" value={left_label} placeholder="Weak" onChange={(v) => onChange({ ...config, left_label: v })} />
        <TextField label="Right adjective" value={right_label} placeholder="Strong" onChange={(v) => onChange({ ...config, right_label: v })} />
      </div>
      <NumberField
        label="Number of points"
        hint="Odd numbers give respondents a neutral midpoint."
        value={points}
        min={2}
        max={9}
        emptyAs={2}
        onChange={(n) => onChange({ ...config, points: Math.min(Math.max(n || 2, 2), 9) })}
      />
    </SettingsStack>
  );
};

registerBlock('semantic_differential', SemanticDifferentialBlock);

export default SemanticDifferentialBlock;
