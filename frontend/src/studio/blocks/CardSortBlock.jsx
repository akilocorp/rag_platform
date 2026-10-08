// @language JavaScript (React / JSX)
// @updated   2026-10-08
// @changed   Edit mode now renders only the items/categories lists (via the shared
//            OptionListEditor, replacing this file's own ListEditor) for the builder's settings
//            panel — question and Required moved there; respond mode uses the shared QuestionHeader.
// Prior: ListEditor takes an explicit `itemLabel` instead of deriving a singular from `label`
//            via a naive trailing-"s" strip — that turned "Categories" into "+ Add categorie".
//            Prior: New file: the Card Sort block. Respond mode is a per-item category picker — a
//            dropdown when `categories` is non-empty (closed sort), a free-text input when it's
//            empty (open sort) — rather than true drag-tile UI. Same data (which category each item
//            landed in), simpler interaction; see backend src/studio/blocks/card_sort.py.
import React from 'react';
import { registerBlock } from './registryStore';
import {
  FONT_BODY, QuestionHeader, OptionListEditor, SettingsStack,
} from './blockParts';

const CardSortBlock = ({ config, mode = 'edit', onChange, value, onAnswer, error }) => {
  const { items = [], categories = [] } = config || {};

  if (mode === 'respond') {
    const assignments = value || {};
    const setAssignment = (item, category) => onAnswer({ ...assignments, [item]: category });

    return (
      <div className="p-4">
        <QuestionHeader config={config} />
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <div key={item} className="flex items-center gap-2">
              <span className="flex-1 text-sm" style={{ fontFamily: FONT_BODY, color: '#1F1F1F' }}>{item}</span>
              {categories.length > 0 ? (
                <select
                  value={assignments[item] || ''}
                  onChange={(e) => setAssignment(item, e.target.value)}
                  className="text-xs px-2 py-1.5 rounded-md border w-40"
                  style={{ borderColor: 'rgba(31,31,31,0.15)', fontFamily: FONT_BODY, color: '#1F1F1F' }}
                >
                  <option value="" disabled>Choose a category…</option>
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={assignments[item] || ''}
                  onChange={(e) => setAssignment(item, e.target.value)}
                  placeholder="Name a category…"
                  className="text-xs px-2 py-1.5 rounded-md border w-40"
                  style={{ borderColor: 'rgba(31,31,31,0.15)', fontFamily: FONT_BODY, color: '#1F1F1F' }}
                />
              )}
            </div>
          ))}
        </div>
        {error && <p className="text-xs mt-2" style={{ color: '#E5484D', fontFamily: FONT_BODY }}>{error}</p>}
      </div>
    );
  }

  return (
    <SettingsStack>
      <OptionListEditor
        label="Items"
        hint="What respondents sort."
        items={items}
        itemLabel="item"
        minItems={1}
        newItem={(n) => `Item ${n + 1}`}
        onChange={(next) => onChange({ ...config, items: next })}
      />
      <OptionListEditor
        label="Categories"
        hint="Leave empty for an open sort — respondents name their own."
        items={categories}
        itemLabel="category"
        minItems={0}
        newItem={(n) => `Category ${n + 1}`}
        onChange={(next) => onChange({ ...config, categories: next })}
      />
    </SettingsStack>
  );
};

registerBlock('card_sort', CardSortBlock);

export default CardSortBlock;
