// @language JavaScript (React / JSX)
// @updated   2026-10-08
// @changed   Likert support: one-click presets (agreement, frequency, satisfaction, ...) fill
//            `point_labels`, shown under every point; plain numeric scales can carry endpoint labels
//            instead. Edit mode now renders just these scale settings for the builder's settings
//            panel (question / Required moved there); respond mode uses the shared QuestionHeader.
// Prior: New file: the Rating Scale block — config shape matches backend
//            src/studio/blocks/rating_scale.py exactly (question/scale_max/required).
import React from 'react';
import { registerBlock } from './registryStore';
import {
  FONT_BODY, QuestionHeader, NumberField, TextField, FieldLabel, SettingsStack,
} from './blockParts';

// Standard Likert anchor sets. Picking one sets the point count to match and
// labels every point; "Numbers only" clears them back to a plain 1..n scale.
const LIKERT_PRESETS = [
  { key: 'agree5', label: 'Agreement (5)', labels: ['Strongly disagree', 'Disagree', 'Neither agree nor disagree', 'Agree', 'Strongly agree'] },
  { key: 'agree7', label: 'Agreement (7)', labels: ['Strongly disagree', 'Disagree', 'Somewhat disagree', 'Neither agree nor disagree', 'Somewhat agree', 'Agree', 'Strongly agree'] },
  { key: 'freq5', label: 'Frequency (5)', labels: ['Never', 'Rarely', 'Sometimes', 'Often', 'Always'] },
  { key: 'sat5', label: 'Satisfaction (5)', labels: ['Very dissatisfied', 'Dissatisfied', 'Neutral', 'Satisfied', 'Very satisfied'] },
  { key: 'likely5', label: 'Likelihood (5)', labels: ['Very unlikely', 'Unlikely', 'Neutral', 'Likely', 'Very likely'] },
  { key: 'import5', label: 'Importance (5)', labels: ['Not at all important', 'Slightly important', 'Moderately important', 'Very important', 'Extremely important'] },
];

const RatingScaleBlock = ({ config, mode = 'edit', onChange, blockId, value, onAnswer, error }) => {
  const {
    scale_max = 5, min_label = '', max_label = '', point_labels = [],
  } = config || {};
  const points = Array.from({ length: scale_max }, (_, i) => i + 1);
  const labelled = point_labels.length === scale_max;

  if (mode === 'respond') {
    const pointButton = (n) => (
      <button
        type="button"
        name={blockId}
        onClick={() => onAnswer(n)}
        className="w-9 h-9 rounded-full border text-sm font-semibold transition-colors shrink-0"
        style={{
          fontFamily: FONT_BODY,
          borderColor: value === n ? '#FA6C43' : 'rgba(31,31,31,0.15)',
          backgroundColor: value === n ? '#FA6C43' : 'transparent',
          color: value === n ? '#FFFFFF' : '#1F1F1F',
        }}
        aria-pressed={value === n}
        aria-label={labelled ? point_labels[n - 1] : String(n)}
      >
        {n}
      </button>
    );

    return (
      <div className="p-4">
        <QuestionHeader config={config} />
        {labelled ? (
          // Likert: every point carries its anchor underneath, equal-width
          // columns so long anchors wrap instead of pushing points apart.
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${scale_max}, minmax(0, 1fr))` }}>
            {points.map((n) => (
              <div key={n} className="flex flex-col items-center gap-1.5 text-center">
                {pointButton(n)}
                <span className="text-[11px] leading-tight" style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.6)' }}>
                  {point_labels[n - 1]}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="inline-flex flex-col max-w-full">
            <div className="flex gap-2 flex-wrap">{points.map((n) => <React.Fragment key={n}>{pointButton(n)}</React.Fragment>)}</div>
            {(min_label || max_label) && (
              <div className="flex justify-between gap-4 mt-1.5 text-[11px]" style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.55)' }}>
                <span>{min_label}</span>
                <span className="text-right">{max_label}</span>
              </div>
            )}
          </div>
        )}
        {error && <p className="text-xs mt-2" style={{ color: '#E5484D', fontFamily: FONT_BODY }}>{error}</p>}
      </div>
    );
  }

  // Changing the point count drops per-point labels that no longer line up
  // (the backend would discard them anyway — see rating_scale.py).
  const setPoints = (n) => {
    const next = Math.min(Math.max(n || 2, 2), 10);
    onChange({ ...config, scale_max: next, point_labels: point_labels.length === next ? point_labels : [] });
  };
  const activePreset = LIKERT_PRESETS.find((p) => labelled && p.labels.join('|') === point_labels.join('|'));

  return (
    <SettingsStack>
      <div>
        <FieldLabel hint="Labels every point with a standard Likert anchor set.">Scale type</FieldLabel>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onChange({ ...config, point_labels: [] })}
            className="px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-colors"
            style={{
              fontFamily: FONT_BODY,
              borderColor: !labelled ? '#FA6C43' : 'rgba(31,31,31,0.15)',
              backgroundColor: !labelled ? '#FFF1EA' : 'transparent',
              color: !labelled ? '#FA6C43' : 'rgba(31,31,31,0.7)',
            }}
          >
            Numbers only
          </button>
          {LIKERT_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() => onChange({ ...config, scale_max: preset.labels.length, point_labels: [...preset.labels] })}
              className="px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-colors"
              style={{
                fontFamily: FONT_BODY,
                borderColor: activePreset?.key === preset.key ? '#FA6C43' : 'rgba(31,31,31,0.15)',
                backgroundColor: activePreset?.key === preset.key ? '#FFF1EA' : 'transparent',
                color: activePreset?.key === preset.key ? '#FA6C43' : 'rgba(31,31,31,0.7)',
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <NumberField label="Number of points" value={scale_max} min={2} max={10} emptyAs={2} onChange={setPoints} />

      {labelled ? (
        <div>
          <FieldLabel hint="Edit any anchor to customise the preset.">Point labels</FieldLabel>
          <div className="flex flex-col gap-1.5">
            {point_labels.map((lbl, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <span className="w-4 text-[11px] text-right tabular-nums" style={{ color: 'rgba(31,31,31,0.35)', fontFamily: FONT_BODY }}>{idx + 1}</span>
                <input
                  type="text"
                  value={lbl}
                  onChange={(e) => onChange({ ...config, point_labels: point_labels.map((p, i) => (i === idx ? e.target.value : p)) })}
                  className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md border text-sm"
                  style={{ borderColor: 'rgba(31,31,31,0.1)', fontFamily: FONT_BODY, color: '#1F1F1F' }}
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <TextField label="Low end label" value={min_label} placeholder="e.g. Not at all" onChange={(v) => onChange({ ...config, min_label: v })} />
          <TextField label="High end label" value={max_label} placeholder="e.g. Extremely" onChange={(v) => onChange({ ...config, max_label: v })} />
        </div>
      )}
    </SettingsStack>
  );
};

registerBlock('rating_scale', RatingScaleBlock);

export default RatingScaleBlock;
