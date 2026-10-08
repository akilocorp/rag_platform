// @language JavaScript (React / JSX)
// @updated   2026-10-08
// @changed   New file: the Studio builder's right-hand settings panel for the selected block. Four
//            tabs — Edit (rich-text question with piped answers, help text, the block's own settings,
//            required / request response), Logic (display logic), Data (export variable name,
//            reverse scoring, numeric codes) and Instruments (attach, configure, remove) — so the
//            canvas can stay a clean preview of what respondents will see.
import React, { useMemo, useRef, useState } from 'react';
import {
  FaTimes, FaBold, FaItalic, FaLink, FaListUl, FaRegCopy, FaTrash, FaLock, FaExclamationTriangle, FaPlus,
} from 'react-icons/fa';
import { getBlockComponent } from './blocks/registry';
import { getInstrumentConfigEditor } from './instruments/registry';
import {
  FONT_BODY, FieldLabel, ToggleField, TextField,
} from './blocks/blockParts';
import {
  PIPE_RE, pipeToken, plainText, wrapSelection, insertAtCursor, bulletLines,
} from './richTextFormat';
import { LOGIC_OPS, OTHER_OPTION, SCALE_TYPES } from './blockRules';
import { groupSpecs, INSTRUMENT_CATEGORIES } from './categories';

const INK = '#1F1F1F';
const MUTED = 'rgba(31,31,31,0.5)';
const BORDER = 'rgba(31,31,31,0.15)';
const ORANGE = '#FA6C43';

// Block types whose own edit view has nothing to show (their only settings
// are the shared ones), so the "Answer settings" section is skipped for them.
const NO_TYPE_SETTINGS = new Set(['yes_no', 'rich_text']);
const CODEABLE_TYPES = new Set(['single_choice', 'yes_no']);
const CHOICE_TYPES = new Set(['single_choice', 'yes_no']);
const TEXT_TYPES = new Set(['short_text', 'long_text']);

const isAnswerable = (blk) => 'required' in (blk.config || {});

const Section = ({ title, children }) => (
  <section className="px-5 py-4 border-b border-gray-100 last:border-b-0">
    {title && (
      <h3 className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: 'rgba(31,31,31,0.4)', fontFamily: FONT_BODY }}>
        {title}
      </h3>
    )}
    {children}
  </section>
);

const Notice = ({ children, tone = 'muted' }) => (
  <p
    className="flex items-start gap-1.5 text-[11px] leading-snug px-2.5 py-2 rounded-lg"
    style={{
      fontFamily: FONT_BODY,
      backgroundColor: tone === 'warn' ? '#FFF6E5' : 'rgba(31,31,31,0.04)',
      color: tone === 'warn' ? '#8A5A00' : MUTED,
    }}
  >
    {tone === 'warn' && <FaExclamationTriangle size={10} className="mt-0.5 shrink-0" />}
    <span>{children}</span>
  </p>
);

const selectStyle = { borderColor: BORDER, fontFamily: FONT_BODY, color: INK };

// "Q3 · How satisfied are you…" — how other blocks are named in pickers.
const blockLabel = (blk, numbering) => {
  const text = plainText(blk.config?.question || blk.config?.content) || 'Untitled';
  const short = text.length > 48 ? `${text.slice(0, 48)}…` : text;
  return numbering[blk.id] ? `${numbering[blk.id]} · ${short}` : short;
};

// Textarea with a formatting toolbar (bold, italic, link, bullet list) and an
// "Insert answer" picker for piped text. Edits go through the pure helpers in
// richText.jsx, then the cursor/selection is restored on the next frame —
// after React has written the new value back into the textarea.
const RichTextField = ({
  label, hint, value, onChange, rows = 3, placeholder, pipeSources, numbering,
}) => {
  const ref = useRef(null);
  const [pipeOpen, setPipeOpen] = useState(false);
  const text = value || '';

  const apply = ({ next, selStart, selEnd }) => {
    onChange(next);
    requestAnimationFrame(() => {
      const ta = ref.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(selStart, selEnd);
    });
  };

  const bold = () => apply(wrapSelection(ref.current, text, '**'));
  const italic = () => apply(wrapSelection(ref.current, text, '*'));
  const link = () => apply(wrapSelection(ref.current, text, '[', '](https://)', 'link text'));
  const list = () => apply(bulletLines(ref.current, text));

  const onKeyDown = (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.key === 'b') { e.preventDefault(); bold(); }
    if (e.key === 'i') { e.preventDefault(); italic(); }
  };

  // Every piped token in the text, flagged when it points at a block that's
  // gone or isn't above this one (it would always pipe in a dash).
  const pipes = useMemo(() => {
    const valid = new Set((pipeSources || []).map((b) => b.id));
    const seen = [];
    for (const m of text.matchAll(PIPE_RE)) {
      if (!seen.some((p) => p.id === m[1])) seen.push({ id: m[1], ok: valid.has(m[1]) });
    }
    return seen;
  }, [text, pipeSources]);

  const toolButton = (Icon, title, onClick) => (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      aria-label={title}
      className="w-7 h-7 flex items-center justify-center rounded-md transition-colors hover:bg-gray-100"
      style={{ color: 'rgba(31,31,31,0.6)' }}
    >
      <Icon size={11} />
    </button>
  );

  return (
    <div>
      {label && <FieldLabel hint={hint}>{label}</FieldLabel>}
      <div className="rounded-lg border focus-within:border-[#FA6C43] transition-colors" style={{ borderColor: BORDER }}>
        <div className="relative flex items-center gap-0.5 px-1 py-1 border-b" style={{ borderColor: 'rgba(31,31,31,0.08)' }}>
          {toolButton(FaBold, 'Bold (Ctrl+B)', bold)}
          {toolButton(FaItalic, 'Italic (Ctrl+I)', italic)}
          {toolButton(FaLink, 'Link', link)}
          {toolButton(FaListUl, 'Bulleted list', list)}
          {pipeSources && (
            <>
              <span className="w-px h-4 mx-1" style={{ backgroundColor: 'rgba(31,31,31,0.12)' }} />
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setPipeOpen((o) => !o)}
                className="flex items-center gap-1 px-2 h-7 rounded-md text-[11px] font-semibold transition-colors hover:bg-gray-100"
                style={{ color: pipeOpen ? ORANGE : 'rgba(31,31,31,0.6)', fontFamily: FONT_BODY }}
                aria-expanded={pipeOpen}
              >
                <FaPlus size={8} /> Insert answer
              </button>
            </>
          )}
          {pipeOpen && (
            <div
              className="absolute left-1 right-1 top-full mt-1 z-20 max-h-56 overflow-y-auto rounded-xl shadow-xl bg-white border border-gray-100 p-1.5 animate-in fade-in duration-150"
              style={{ fontFamily: FONT_BODY }}
            >
              {pipeSources.length === 0 ? (
                <p className="px-2 py-2 text-[11px]" style={{ color: MUTED }}>
                  Piped text pulls in an answer from a question above this one. Add one first.
                </p>
              ) : pipeSources.map((src) => (
                <button
                  key={src.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { apply(insertAtCursor(ref.current, text, pipeToken(src.id))); setPipeOpen(false); }}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors hover:bg-[#F0F6FB]"
                  style={{ color: INK }}
                >
                  {blockLabel(src, numbering)}
                </button>
              ))}
            </div>
          )}
        </div>
        <textarea
          ref={ref}
          rows={rows}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="w-full px-3 py-2 text-sm resize-y bg-transparent outline-none rounded-b-lg"
          style={{ fontFamily: FONT_BODY, color: INK }}
        />
      </div>
      {pipes.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {pipes.map((p) => (
            <span
              key={p.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
              style={{
                fontFamily: FONT_BODY,
                backgroundColor: p.ok ? '#E8EEFB' : '#FFF6E5',
                color: p.ok ? '#3552A6' : '#8A5A00',
              }}
              title={p.ok ? undefined : 'This question is gone or now sits below this one, so nothing can be piped in.'}
            >
              {p.ok ? <FaLink size={8} /> : <FaExclamationTriangle size={8} />}
              {p.ok ? `Answer to ${numbering[p.id]}` : 'Broken pipe'}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

// Which comparison operators make sense for a source block's answer shape.
// Ranking/allocation/voice answers have no single comparable value, so they
// only support answered / skipped.
const opsFor = (src) => {
  if (!src) return [];
  const t = src.type;
  const numericText = t === 'short_text' && src.config?.input_format === 'number';
  return LOGIC_OPS.filter(({ numeric, needsValue }) => {
    if (!needsValue) return true;
    if (numeric) return SCALE_TYPES.includes(t) || numericText;
    return CHOICE_TYPES.has(t) || SCALE_TYPES.includes(t) || TEXT_TYPES.has(t);
  });
};

// The fixed set of values a source's answer can take, for a dropdown — or
// null when it's free text and needs a typed value instead.
const valueChoicesFor = (src) => {
  const cfg = src?.config || {};
  if (src?.type === 'yes_no') return ['Yes', 'No'].map((v) => ({ value: v, label: v }));
  if (src?.type === 'single_choice') {
    const opts = (cfg.options || []).map((o) => ({ value: o, label: o }));
    return cfg.allow_other ? [...opts, { value: OTHER_OPTION, label: 'Other (any text)' }] : opts;
  }
  if (src?.type === 'rating_scale') {
    const labels = (cfg.point_labels || []).length === cfg.scale_max ? cfg.point_labels : null;
    return Array.from({ length: cfg.scale_max || 5 }, (_, i) => ({
      value: String(i + 1), label: labels ? `${i + 1} — ${labels[i]}` : String(i + 1),
    }));
  }
  if (src?.type === 'semantic_differential') {
    return Array.from({ length: cfg.points || 7 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));
  }
  return null;
};

// Display logic: "only show this block if <earlier question> <op> <value>".
// A rule whose source has been deleted or dragged below this block is shown
// with a warning — the server drops such rules on save (link_display_logic),
// so silently keeping it here would let the builder disagree with the form.
const LogicEditor = ({ config, onChange, sources, numbering }) => {
  const logic = config.display_logic;
  const source = logic ? sources.find((s) => s.id === logic.source_block_id) : null;
  const setLogic = (next) => onChange({ ...config, display_logic: next });

  const ruleFor = (src) => ({ source_block_id: src.id, op: opsFor(src)[0]?.op || 'answered', value: '' });

  if (sources.length === 0) {
    return (
      <Notice>
        Display logic shows or hides this block based on an earlier answer. Add a question above this one to
        build a rule on it.
      </Notice>
    );
  }

  const ops = opsFor(source);
  const opMeta = LOGIC_OPS.find((o) => o.op === logic?.op);
  const choices = valueChoicesFor(source);

  return (
    <div className="flex flex-col gap-3">
      <ToggleField
        label="Only show this block if…"
        hint="Otherwise everyone sees it. A hidden question is never required."
        checked={!!logic}
        onChange={(on) => setLogic(on ? ruleFor(sources[sources.length - 1]) : null)}
      />

      {logic && (
        <div className="flex flex-col gap-2 p-3 rounded-xl animate-in fade-in duration-150" style={{ backgroundColor: 'rgba(31,31,31,0.035)' }}>
          {!source && (
            <Notice tone="warn">
              The question this rule used is gone or now sits below this block, so the rule is ignored. Pick
              another question.
            </Notice>
          )}
          <select
            value={source ? source.id : ''}
            onChange={(e) => setLogic(ruleFor(sources.find((s) => s.id === e.target.value)))}
            className="w-full text-xs px-2 py-1.5 rounded-md border bg-white"
            style={selectStyle}
          >
            {!source && <option value="" disabled>Choose a question…</option>}
            {sources.map((s) => <option key={s.id} value={s.id}>{blockLabel(s, numbering)}</option>)}
          </select>

          {source && (
            <div className="flex gap-2">
              <select
                value={logic.op}
                onChange={(e) => setLogic({ ...logic, op: e.target.value, value: '' })}
                className="flex-1 text-xs px-2 py-1.5 rounded-md border bg-white"
                style={selectStyle}
              >
                {ops.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
              </select>

              {opMeta?.needsValue && (
                choices && !opMeta.numeric ? (
                  <select
                    value={logic.value}
                    onChange={(e) => setLogic({ ...logic, value: e.target.value })}
                    className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded-md border bg-white"
                    style={selectStyle}
                  >
                    <option value="" disabled>Value…</option>
                    {choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                ) : (
                  <input
                    type={opMeta.numeric ? 'number' : 'text'}
                    value={logic.value}
                    onChange={(e) => setLogic({ ...logic, value: e.target.value })}
                    placeholder={opMeta.numeric ? 'Number' : 'Exact answer'}
                    className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded-md border bg-white"
                    style={selectStyle}
                  />
                )
              )}
            </div>
          )}

          {source && opMeta?.needsValue && logic.value === '' && (
            <Notice tone="warn">Pick a value. Until then, this block stays hidden for everyone.</Notice>
          )}
          {source && TEXT_TYPES.has(source.type) && logic.op === 'equals' && (
            <Notice>Text matches exactly, including capitals and spacing.</Notice>
          )}
        </div>
      )}
    </div>
  );
};

// Same coercion the server applies (block_settings._clean_variable_name),
// minus the trailing-underscore trim, which would fight the professor's
// typing ("trust_" is a prefix of "trust_1").
const sanitizeVariableName = (v) => v.replace(/[^A-Za-z0-9_]+/g, '_').slice(0, 40);

// Data tab: how this block lands in the CSV export.
const DataEditor = ({ block, blocks, onChange }) => {
  const cfg = block.config || {};
  const name = cfg.variable_name || '';
  const duplicate = name && blocks.some(
    (b) => b.id !== block.id && (b.config?.variable_name || '').toLowerCase() === name.toLowerCase(),
  );
  const header = name || plainText(cfg.question) || block.id;
  const columns = [header];
  if (cfg.reverse_scored) columns.push(`${header}_r`);
  if (cfg.export_codes) columns.push(`${header}_code`);

  const codeLegend = block.type === 'yes_no'
    ? 'Yes = 1, No = 0'
    : [...(cfg.options || []), ...(cfg.allow_other ? [OTHER_OPTION] : [])].map((o, i) => `${o} = ${i + 1}`).join(', ');

  return (
    <div className="flex flex-col gap-3.5">
      <TextField
        label="Variable name"
        hint="The column header in your CSV export. Leave blank to use the question text."
        value={name}
        placeholder="e.g. trust_1"
        onChange={(v) => onChange({ ...cfg, variable_name: sanitizeVariableName(v) })}
      />
      {duplicate && <Notice tone="warn">Another block already uses this name. Names must be unique, so the later one is cleared on save.</Notice>}

      {SCALE_TYPES.includes(block.type) && (
        <ToggleField
          label="Reverse-scored item"
          hint="Adds a column with the scale flipped (1 ↔ highest), for negatively worded items."
          checked={cfg.reverse_scored}
          onChange={(v) => onChange({ ...cfg, reverse_scored: v })}
        />
      )}
      {CODEABLE_TYPES.has(block.type) && (
        <ToggleField
          label="Export numeric codes"
          hint={`Adds a column with each answer as a number: ${codeLegend}.`}
          checked={cfg.export_codes}
          onChange={(v) => onChange({ ...cfg, export_codes: v })}
        />
      )}

      <div>
        <FieldLabel>CSV columns</FieldLabel>
        <div className="flex flex-wrap gap-1">
          {columns.map((c) => (
            <code key={c} className="px-1.5 py-0.5 rounded text-[11px] max-w-full truncate" style={{ backgroundColor: 'rgba(31,31,31,0.06)', color: INK }}>
              {c}
            </code>
          ))}
        </div>
      </div>
    </div>
  );
};

// Instruments tab: what's attached (each with its own config editor) and a
// categorized list of compatible ones to add. This is also the only way to
// attach an instrument without dragging — the left rail is drag-only for them.
const InstrumentsEditor = ({
  block, siblings, instrumentSpecs, iconFor, onAttach, onRemove, onConfigChange, onLocked,
}) => {
  const attached = block.instruments || [];
  const specByType = Object.fromEntries(instrumentSpecs.map((s) => [s.type, s]));
  const available = instrumentSpecs.filter(
    (s) => (!s.applies_to || s.applies_to.includes(block.type)) && !attached.some((i) => i.type === s.type),
  );
  const groups = groupSpecs(available, INSTRUMENT_CATEGORIES);

  return (
    <div className="flex flex-col gap-4">
      {attached.length > 0 && (
        <div className="flex flex-col gap-2">
          {attached.map((inst) => {
            const spec = specByType[inst.type];
            const Icon = iconFor(spec?.icon);
            const ConfigEditor = getInstrumentConfigEditor(inst.type);
            return (
              <div key={inst.id} className="rounded-xl border p-3 animate-in fade-in duration-150" style={{ borderColor: 'rgba(31,31,31,0.1)' }}>
                <div className="flex items-center gap-2">
                  <Icon size={12} style={{ color: ORANGE }} className="shrink-0" />
                  <span className="flex-1 text-xs font-semibold" style={{ color: INK, fontFamily: FONT_BODY }}>{spec?.label || inst.type}</span>
                  <button
                    type="button"
                    onClick={() => onRemove(inst.type)}
                    className="p-1 rounded opacity-40 hover:opacity-100 transition-opacity"
                    aria-label={`Remove ${spec?.label || inst.type}`}
                  >
                    <FaTimes size={10} />
                  </button>
                </div>
                {ConfigEditor && (
                  <div className="mt-2">
                    <ConfigEditor
                      config={inst.config}
                      blockConfig={block.config}
                      allBlocks={siblings}
                      onChange={(cfg) => onConfigChange(inst.type, cfg)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {groups.length === 0 ? (
        <Notice>Every instrument that works with this block is already attached.</Notice>
      ) : groups.map((g) => (
        <div key={g.key}>
          <FieldLabel>{g.label}</FieldLabel>
          <div className="flex flex-col">
            {g.specs.map((spec) => {
              const Icon = iconFor(spec.icon);
              const locked = !!spec.is_ai;
              return (
                <button
                  key={spec.type}
                  type="button"
                  onClick={() => (locked ? onLocked(spec) : onAttach(spec))}
                  className={`flex items-center gap-2 px-2 py-1.5 -mx-2 rounded-lg text-left text-xs transition-colors hover:bg-[#F0F6FB] ${locked ? 'opacity-60' : ''}`}
                  style={{ color: INK, fontFamily: FONT_BODY }}
                >
                  <Icon size={11} className="shrink-0" style={{ color: ORANGE }} />
                  <span className="flex-1">{spec.label}</span>
                  {locked ? <FaLock size={9} style={{ color: MUTED }} /> : <FaPlus size={9} style={{ color: MUTED }} />}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <Notice>You can also drag an instrument from the left rail onto a block.</Notice>
    </div>
  );
};

const BlockInspector = ({
  block, blocks, numbering, spec, instrumentSpecs, iconFor,
  onChange, onClose, onDelete, onDuplicate,
  onAttachInstrument, onRemoveInstrument, onInstrumentConfigChange, onLockedInstrument,
}) => {
  const [tab, setTab] = useState('edit');
  const cfg = block.config || {};
  const answerable = isAnswerable(block);
  const index = blocks.findIndex((b) => b.id === block.id);
  // Answerable blocks above this one — the only legal sources for display
  // logic and piped text (anything below hasn't been answered yet).
  const earlier = blocks.slice(0, Math.max(index, 0)).filter(isAnswerable);
  const siblings = blocks.filter((b) => b.id !== block.id);
  const Component = getBlockComponent(block.type);
  const Icon = iconFor(spec?.icon);

  const randomizerSpec = instrumentSpecs.find(
    (s) => s.type === 'option_randomizer' && (!s.applies_to || s.applies_to.includes(block.type)),
  );
  const randomized = (block.instruments || []).some((i) => i.type === 'option_randomizer');

  const tabs = [
    { key: 'edit', label: 'Edit' },
    { key: 'logic', label: 'Logic', dot: !!cfg.display_logic },
    ...(answerable ? [{ key: 'data', label: 'Data', dot: !!(cfg.variable_name || cfg.reverse_scored || cfg.export_codes) }] : []),
    { key: 'instruments', label: 'Instruments', count: (block.instruments || []).length },
  ];

  return (
    <aside
      className="w-[340px] shrink-0 bg-white border-l border-gray-200 flex flex-col min-h-0 animate-in fade-in duration-150"
      style={{ fontFamily: FONT_BODY }}
      aria-label="Block settings"
    >
      <div className="flex items-center gap-2.5 px-5 pt-4 pb-3">
        <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: '#FFF1EA' }}>
          <Icon size={12} style={{ color: ORANGE }} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold" style={{ color: MUTED }}>{numbering[block.id] || 'Content'}</p>
          <p className="text-sm font-bold truncate" style={{ color: INK }}>{spec?.label || block.type}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          aria-label="Close settings"
        >
          <FaTimes size={12} />
        </button>
      </div>

      <div className="flex gap-1 px-4 border-b border-gray-100" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className="relative flex items-center gap-1 px-2.5 pt-1.5 pb-2.5 text-xs font-semibold transition-colors"
            style={{ color: tab === t.key ? INK : MUTED }}
          >
            {t.label}
            {t.dot && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ORANGE }} />}
            {t.count > 0 && (
              <span className="px-1.5 rounded-full text-[10px] font-bold" style={{ backgroundColor: '#FFF1EA', color: ORANGE }}>{t.count}</span>
            )}
            <span
              className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full transition-colors duration-150"
              style={{ backgroundColor: tab === t.key ? ORANGE : 'transparent' }}
            />
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'edit' && (
          <>
            <Section>
              {block.type === 'rich_text' ? (
                <RichTextField
                  label="Content"
                  hint="Shown to respondents. Captures no answer."
                  value={cfg.content}
                  rows={6}
                  placeholder="Instructions or context…"
                  pipeSources={earlier}
                  numbering={numbering}
                  onChange={(v) => onChange({ ...cfg, content: v })}
                />
              ) : (
                <div className="flex flex-col gap-3.5">
                  <RichTextField
                    label="Question"
                    value={cfg.question}
                    rows={3}
                    placeholder="Ask something…"
                    pipeSources={earlier}
                    numbering={numbering}
                    onChange={(v) => onChange({ ...cfg, question: v })}
                  />
                  <label className="block">
                    <FieldLabel hint="Smaller text under the question, for instructions or examples.">Help text</FieldLabel>
                    <textarea
                      rows={2}
                      value={cfg.help_text || ''}
                      onChange={(e) => onChange({ ...cfg, help_text: e.target.value })}
                      placeholder="Optional"
                      className="w-full px-2.5 py-1.5 rounded-md border text-sm resize-y"
                      style={{ borderColor: BORDER, fontFamily: FONT_BODY, color: INK }}
                    />
                  </label>
                </div>
              )}
            </Section>

            {Component && !NO_TYPE_SETTINGS.has(block.type) && (
              <Section title="Answer settings">
                <Component config={cfg} mode="edit" onChange={onChange} blockId={block.id} />
                {randomizerSpec && (
                  <div className="mt-3.5">
                    <ToggleField
                      label="Randomize choice order"
                      hint="Each respondent sees the choices in their own stable order."
                      checked={randomized}
                      onChange={(on) => (on ? onAttachInstrument(randomizerSpec) : onRemoveInstrument('option_randomizer'))}
                    />
                  </div>
                )}
              </Section>
            )}

            {answerable && (
              <Section title="Response">
                <div className="flex flex-col gap-3.5">
                  <ToggleField
                    label="Required"
                    hint="Respondents can't submit without answering."
                    checked={cfg.required}
                    onChange={(v) => onChange({ ...cfg, required: v, request_response: v ? false : cfg.request_response })}
                  />
                  <ToggleField
                    label="Request a response"
                    hint="If skipped, respondents are asked once whether they want to answer — but can still move on."
                    checked={cfg.request_response}
                    disabled={cfg.required}
                    onChange={(v) => onChange({ ...cfg, request_response: v })}
                  />
                </div>
              </Section>
            )}
          </>
        )}

        {tab === 'logic' && (
          <Section title="Display logic">
            <LogicEditor config={cfg} onChange={onChange} sources={earlier} numbering={numbering} />
          </Section>
        )}

        {tab === 'data' && answerable && (
          <Section title="Export">
            <DataEditor block={block} blocks={blocks} onChange={onChange} />
          </Section>
        )}

        {tab === 'instruments' && (
          <Section title="Instruments">
            <InstrumentsEditor
              block={block}
              siblings={siblings}
              instrumentSpecs={instrumentSpecs}
              iconFor={iconFor}
              onAttach={onAttachInstrument}
              onRemove={onRemoveInstrument}
              onConfigChange={onInstrumentConfigChange}
              onLocked={onLockedInstrument}
            />
          </Section>
        )}
      </div>

      <div className="flex items-center gap-2 px-5 py-3 border-t border-gray-100">
        <button
          type="button"
          onClick={onDuplicate}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
        >
          <FaRegCopy size={11} /> Duplicate
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors ml-auto"
        >
          <FaTrash size={10} /> Delete block
        </button>
      </div>
    </aside>
  );
};

export default BlockInspector;
