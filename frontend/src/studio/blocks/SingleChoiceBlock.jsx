// @language JavaScript (React / JSX)
// @updated   2026-10-08
// @changed   Added a horizontal layout and "Other, please specify" (answer stored as "Other: <text>").
//            Edit mode now renders only the option settings for the builder's settings panel — the
//            question and Required moved there; respond mode uses the shared QuestionHeader.
// Prior: Phase 1: replaced the unused `readOnly` disabled-preview with a real `mode` prop.
//            `mode="respond"` is now actually-interactive radios wired to `value`/`onAnswer`,
//            used by StudioRunnerPage; `mode="edit"` (default) is unchanged, used by the builder.
import React from 'react';
import { registerBlock } from './registryStore';
import {
  FONT_BODY, QuestionHeader, OptionListEditor, SegmentedField, ToggleField, SettingsStack,
} from './blockParts';
import { OTHER_OPTION, OTHER_PREFIX } from '../blockRules';

const SingleChoiceBlock = ({ config, mode = 'edit', onChange, blockId, value, onAnswer, error }) => {
  const { options = [], layout = 'vertical', allow_other = false } = config || {};

  if (mode === 'respond') {
    const otherPicked = typeof value === 'string' && value.startsWith(OTHER_PREFIX);
    const horizontal = layout === 'horizontal';
    const optionRow = (label, checked, onSelect, key) => (
      <label
        key={key}
        className={`flex items-center gap-2 text-sm cursor-pointer ${horizontal ? 'px-3 py-1.5 rounded-lg border' : ''}`}
        style={{
          fontFamily: FONT_BODY,
          color: '#1F1F1F',
          ...(horizontal ? { borderColor: checked ? '#FA6C43' : 'rgba(31,31,31,0.15)', backgroundColor: checked ? '#FFF1EA' : 'transparent' } : {}),
        }}
      >
        <input type="radio" name={blockId} checked={checked} onChange={onSelect} />
        {label}
      </label>
    );

    return (
      <div className="p-4">
        <QuestionHeader config={config} />
        <div className={horizontal ? 'flex flex-wrap gap-2' : 'flex flex-col gap-2'}>
          {options.map((opt, idx) => optionRow(opt, value === opt, () => onAnswer(opt), idx))}
          {allow_other && optionRow(OTHER_OPTION, otherPicked, () => { if (!otherPicked) onAnswer(OTHER_PREFIX); }, 'other')}
        </div>
        {otherPicked && (
          <input
            type="text"
            autoFocus
            value={value.slice(OTHER_PREFIX.length)}
            onChange={(e) => onAnswer(OTHER_PREFIX + e.target.value)}
            placeholder="Please specify"
            aria-label="Other, please specify"
            className="mt-2 w-full px-3 py-2 rounded-lg border text-sm"
            style={{ borderColor: 'rgba(31,31,31,0.2)', fontFamily: FONT_BODY, color: '#1F1F1F' }}
          />
        )}
        {error && <p className="text-xs mt-2" style={{ color: '#E5484D', fontFamily: FONT_BODY }}>{error}</p>}
      </div>
    );
  }

  return (
    <SettingsStack>
      <OptionListEditor label="Choices" items={options} onChange={(next) => onChange({ ...config, options: next })} />
      <ToggleField
        label="Add “Other, please specify”"
        hint="Adds an Other choice with a text box."
        checked={allow_other}
        onChange={(v) => onChange({ ...config, allow_other: v })}
      />
      <SegmentedField
        label="Layout"
        value={layout}
        options={[{ value: 'vertical', label: 'Vertical' }, { value: 'horizontal', label: 'Horizontal' }]}
        onChange={(v) => onChange({ ...config, layout: v })}
      />
    </SettingsStack>
  );
};

registerBlock('single_choice', SingleChoiceBlock);

export default SingleChoiceBlock;
