// @language JavaScript (React / JSX)
// @updated   2026-10-08
// @changed   New file: pieces every block file shares — QuestionHeader (the rich-text question,
//            required star and help text above a respond-mode block) and the small form fields
//            block settings are built from, now that each block's settings render in the
//            builder's right-hand panel. Deliberately not named *Block.jsx, so registry.js's glob
//            doesn't try to load it as a block.
import React from 'react';
import { FaTimes } from 'react-icons/fa';
import { RichText } from '../richText';

export const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";
const MUTED = 'rgba(31,31,31,0.6)';
const BORDER = 'rgba(31,31,31,0.15)';

// The question as respondents see it: rich text, an orange star when
// required, and the optional help text beneath. `as="label"` + `htmlFor`
// for blocks whose answer is a single input.
export const QuestionHeader = ({ config, as = 'p', htmlFor, className = 'mb-3' }) => {
  const Tag = as;
  return (
    <div className={className}>
      <Tag
        htmlFor={htmlFor}
        className="block text-sm font-semibold"
        style={{ fontFamily: FONT_BODY, color: '#1F1F1F' }}
      >
        <RichText text={config?.question} inline />
        {config?.required && <span style={{ color: '#FA6C43' }}> *</span>}
      </Tag>
      {config?.help_text && (
        <p className="text-xs mt-1 whitespace-pre-wrap" style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.55)' }}>
          {config.help_text}
        </p>
      )}
    </div>
  );
};

export const FieldLabel = ({ children, hint }) => (
  <div className="mb-1">
    <p className="text-xs font-semibold" style={{ fontFamily: FONT_BODY, color: '#1F1F1F' }}>{children}</p>
    {hint && <p className="text-[11px] leading-snug" style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.45)' }}>{hint}</p>}
  </div>
);

export const TextField = ({ label, hint, value, onChange, placeholder }) => (
  <label className="block">
    {label && <FieldLabel hint={hint}>{label}</FieldLabel>}
    <input
      type="text"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-2.5 py-1.5 rounded-md border text-sm"
      style={{ borderColor: BORDER, fontFamily: FONT_BODY, color: '#1F1F1F' }}
    />
  </label>
);

// Number input that reports a Number, or `emptyAs` while the box is cleared.
// With the default emptyAs of 0 ("no limit"), 0 shows as an empty box with a
// dash placeholder rather than a literal 0.
export const NumberField = ({ label, hint, value, onChange, min, max, emptyAs = 0, suffix }) => (
  <label className="flex items-center justify-between gap-3">
    <FieldLabel hint={hint}>{label}</FieldLabel>
    <span className="flex items-center gap-1.5 shrink-0">
      <input
        type="number"
        min={min}
        max={max}
        value={emptyAs === 0 && !value ? '' : value}
        placeholder={emptyAs === 0 ? '—' : undefined}
        onChange={(e) => onChange(e.target.value === '' ? emptyAs : Number(e.target.value))}
        className="w-16 px-2 py-1 rounded-md border text-sm text-right"
        style={{ borderColor: BORDER, fontFamily: FONT_BODY, color: '#1F1F1F' }}
      />
      {suffix && <span className="text-[11px]" style={{ color: MUTED, fontFamily: FONT_BODY }}>{suffix}</span>}
    </span>
  </label>
);

// A labelled on/off switch — the settings panel's standard boolean control.
export const ToggleField = ({ label, hint, checked, onChange, disabled = false }) => (
  <label className={`flex items-start justify-between gap-3 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
    <FieldLabel hint={hint}>{label}</FieldLabel>
    <span className="relative inline-flex shrink-0 mt-0.5">
      <input
        type="checkbox"
        className="sr-only peer"
        checked={!!checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        className="w-8 h-[18px] rounded-full transition-colors duration-150"
        style={{ backgroundColor: checked ? '#FA6C43' : 'rgba(31,31,31,0.18)' }}
      />
      <span
        className="absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-[left] duration-150"
        style={{ left: checked ? 16 : 2 }}
      />
    </span>
  </label>
);

// Pick-one pill row (layout, input format, ...).
export const SegmentedField = ({ label, hint, value, options, onChange }) => (
  <div>
    {label && <FieldLabel hint={hint}>{label}</FieldLabel>}
    <div className="flex p-0.5 rounded-lg" style={{ backgroundColor: 'rgba(31,31,31,0.06)' }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className="flex-1 px-2 py-1 rounded-md text-xs font-semibold transition-colors"
          style={{
            fontFamily: FONT_BODY,
            backgroundColor: value === opt.value ? '#FFFFFF' : 'transparent',
            color: value === opt.value ? '#1F1F1F' : MUTED,
            boxShadow: value === opt.value ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  </div>
);

// Editable list of strings (choice options, card-sort items, ...). Enter in
// the last row adds a new one, so a professor can type a whole list without
// reaching for the mouse.
export const OptionListEditor = ({ label, hint, items, onChange, itemLabel = 'option', newItem, minItems = 2 }) => {
  const update = (idx, val) => onChange(items.map((it, i) => (i === idx ? val : it)));
  const add = () => onChange([...items, newItem ? newItem(items.length) : `Option ${items.length + 1}`]);
  const remove = (idx) => onChange(items.filter((_, i) => i !== idx));

  return (
    <div>
      {label && <FieldLabel hint={hint}>{label}</FieldLabel>}
      <div className="flex flex-col gap-1.5">
        {items.map((item, idx) => (
          <div key={idx} className="group/opt flex items-center gap-1.5">
            <span className="w-4 text-[11px] text-right tabular-nums shrink-0" style={{ color: 'rgba(31,31,31,0.35)', fontFamily: FONT_BODY }}>
              {idx + 1}
            </span>
            <input
              type="text"
              value={item}
              onChange={(e) => update(idx, e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && idx === items.length - 1) { e.preventDefault(); add(); } }}
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md border text-sm"
              style={{ borderColor: 'rgba(31,31,31,0.1)', fontFamily: FONT_BODY, color: '#1F1F1F' }}
            />
            {items.length > minItems && (
              <button
                type="button"
                onClick={() => remove(idx)}
                className="p-1 rounded opacity-40 hover:opacity-100 transition-opacity"
                style={{ color: '#1F1F1F' }}
                aria-label={`Remove ${itemLabel} ${idx + 1}`}
              >
                <FaTimes size={10} />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={add}
          className="self-start text-xs font-semibold mt-0.5 ml-5"
          style={{ color: '#FA6C43', fontFamily: FONT_BODY }}
        >
          + Add {itemLabel}
        </button>
      </div>
    </div>
  );
};

// Vertical stack for a block's settings, matching the panel's section rhythm.
export const SettingsStack = ({ children }) => <div className="flex flex-col gap-3.5">{children}</div>;
