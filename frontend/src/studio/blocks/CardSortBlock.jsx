// @language JavaScript (React / JSX)
// @updated   2026-09-08
// @changed   ListEditor takes an explicit `itemLabel` instead of deriving a singular from `label`
//            via a naive trailing-"s" strip — that turned "Categories" into "+ Add categorie".
//            Prior: New file: the Card Sort block. Respond mode is a per-item category picker — a
//            dropdown when `categories` is non-empty (closed sort), a free-text input when it's
//            empty (open sort) — rather than true drag-tile UI. Same data (which category each item
//            landed in), simpler interaction; see backend src/studio/blocks/card_sort.py.
import React from 'react';
import { registerBlock } from './registryStore';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

const ListEditor = ({ label, itemLabel, items, onUpdate, onAdd, onRemove, minItems = 1 }) => (
  <div className="flex flex-col gap-1.5 mt-1">
    <p className="text-xs font-semibold" style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.6)' }}>{label}</p>
    {items.map((item, idx) => (
      <div key={idx} className="flex items-center gap-2">
        <input
          type="text"
          value={item}
          onChange={(e) => onUpdate(idx, e.target.value)}
          className="flex-1 px-2.5 py-1.5 rounded-md border text-sm"
          style={{ borderColor: 'rgba(31,31,31,0.1)', fontFamily: FONT_BODY, color: '#1F1F1F' }}
        />
        {items.length > minItems && (
          <button
            type="button"
            onClick={() => onRemove(idx)}
            className="text-xs px-1.5"
            style={{ color: 'rgba(31,31,31,0.4)' }}
            aria-label={`Remove ${label.toLowerCase()}`}
          >
            &times;
          </button>
        )}
      </div>
    ))}
    <button
      type="button"
      onClick={onAdd}
      className="self-start text-xs font-semibold mt-0.5"
      style={{ color: '#FA6C43', fontFamily: FONT_BODY }}
    >
      + Add {itemLabel}
    </button>
  </div>
);

const CardSortBlock = ({ config, mode = 'edit', onChange, value, onAnswer, error }) => {
  const { question = '', items = [], categories = [], required = false } = config || {};

  const updateItem = (idx, val) => { const next = [...items]; next[idx] = val; onChange({ ...config, items: next }); };
  const addItem = () => onChange({ ...config, items: [...items, `Item ${items.length + 1}`] });
  const removeItem = (idx) => onChange({ ...config, items: items.filter((_, i) => i !== idx) });

  const updateCategory = (idx, val) => { const next = [...categories]; next[idx] = val; onChange({ ...config, categories: next }); };
  const addCategory = () => onChange({ ...config, categories: [...categories, `Category ${categories.length + 1}`] });
  const removeCategory = (idx) => onChange({ ...config, categories: categories.filter((_, i) => i !== idx) });

  if (mode === 'respond') {
    const assignments = value || {};
    const setAssignment = (item, category) => onAnswer({ ...assignments, [item]: category });

    return (
      <div className="p-4">
        <p className="text-sm font-semibold mb-3" style={{ fontFamily: FONT_BODY, color: '#1F1F1F' }}>
          {question} {required && <span style={{ color: '#FA6C43' }}>*</span>}
        </p>
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
    <div className="p-4 flex flex-col gap-2">
      <input
        type="text"
        value={question}
        onChange={(e) => onChange({ ...config, question: e.target.value })}
        placeholder="Question text"
        className="w-full px-3 py-2 rounded-lg border text-sm font-semibold"
        style={{ borderColor: 'rgba(31,31,31,0.15)', fontFamily: FONT_BODY, color: '#1F1F1F' }}
      />
      <ListEditor label="Items" itemLabel="item" items={items} onUpdate={updateItem} onAdd={addItem} onRemove={removeItem} minItems={1} />
      <ListEditor label="Categories" itemLabel="category" items={categories} onUpdate={updateCategory} onAdd={addCategory} onRemove={removeCategory} minItems={0} />
      <p className="text-[11px] mt-0.5" style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.45)' }}>
        No categories = open sort (respondent names their own).
      </p>
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

registerBlock('card_sort', CardSortBlock);

export default CardSortBlock;
