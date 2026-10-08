// @language JavaScript (React / JSX)
// @updated   2026-10-08
// @changed   New "Must add up exactly" setting (`enforce_total`) — the runner now blocks Submit on an
//            off-total allocation when it's on (studio/blockRules.js answerProblem). Edit mode renders
//            only the allocation settings for the builder's settings panel — the question and
//            Required moved there; respond mode uses the shared QuestionHeader.
// Prior: Allocations can't go negative (min=0 + clamp on input) — the server drops negative
//            allocations, so accepting them here silently lost the respondent's entry.
// Prior: New file: the Constant Sum block. Respond mode shows a running total against the
//            target and colors it red/green — feedback only, doesn't block Submit (see backend
//            src/studio/blocks/constant_sum.py for why: no page-level mechanism today for a block
//            to fail validation beyond the generic "required" check).
import React from 'react';
import { registerBlock } from './registryStore';
import {
  FONT_BODY, QuestionHeader, OptionListEditor, NumberField, ToggleField, SettingsStack,
} from './blockParts';

const ConstantSumBlock = ({ config, mode = 'edit', onChange, value, onAnswer, error }) => {
  const { options = [], total = 100, enforce_total = false } = config || {};

  if (mode === 'respond') {
    const allocations = value || {};
    const sum = options.reduce((acc, opt) => acc + (Number(allocations[opt]) || 0), 0);
    const isBalanced = sum === total;

    return (
      <div className="p-4">
        <QuestionHeader config={config} />
        <div className="flex flex-col gap-2">
          {options.map((opt) => (
            <div key={opt} className="flex items-center gap-2">
              <span className="flex-1 text-sm" style={{ fontFamily: FONT_BODY, color: '#1F1F1F' }}>{opt}</span>
              <input
                type="number"
                min={0}
                value={allocations[opt] ?? ''}
                onChange={(e) => onAnswer({ ...allocations, [opt]: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })}
                className="w-20 px-2 py-1 rounded-md border text-sm text-right"
                style={{ borderColor: 'rgba(31,31,31,0.15)', fontFamily: FONT_BODY, color: '#1F1F1F' }}
              />
            </div>
          ))}
        </div>
        <p
          className="text-xs mt-2 font-semibold"
          style={{ fontFamily: FONT_BODY, color: isBalanced ? '#1E7A3D' : '#B85C1E' }}
        >
          Total: {sum} / {total}
        </p>
        {error && <p className="text-xs mt-2" style={{ color: '#E5484D', fontFamily: FONT_BODY }}>{error}</p>}
      </div>
    );
  }

  return (
    <SettingsStack>
      <OptionListEditor label="Options" items={options} onChange={(next) => onChange({ ...config, options: next })} />
      <NumberField
        label="Total to allocate"
        value={total}
        min={1}
        max={1000}
        emptyAs={1}
        onChange={(n) => onChange({ ...config, total: n })}
      />
      <ToggleField
        label="Must add up exactly"
        hint="Respondents can't submit until their numbers reach the total."
        checked={enforce_total}
        onChange={(v) => onChange({ ...config, enforce_total: v })}
      />
    </SettingsStack>
  );
};

registerBlock('constant_sum', ConstantSumBlock);

export default ConstantSumBlock;
