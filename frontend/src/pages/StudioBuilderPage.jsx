// @language JavaScript (React / JSX)
// @updated   2026-10-08
// @changed   Workflow pass. The left rail now shows categories (Content, Scales, Choice, Open text,
//            Ranking & trade-offs, AI — and grouped instruments) that open a flyout of their items
//            with one-line descriptions, replacing "first 6 + overflow". Clicking or adding a block
//            selects it and opens a right-hand settings panel (studio/BlockInspector.jsx) holding
//            every setting; the canvas is now a numbered, read-only preview of what respondents see
//            (piped answers shown as placeholders), with duplicate/delete per block and chips for
//            required / display logic. Escape or a click on empty canvas closes the panel.
// Prior: Block delete button is always visible on touch screens (it was hover-only).
// Prior: Added a "Present" button (orange, next to Responses) linking to the new
//            /studio/:projectId/present route — the Mentimeter-style QR + live-results view.
// Prior: Fixed an overflow bug: the ribbon's "…" popover had no max-height, so with 17
//            instruments now registered (11 landing in overflow) the list ran off the bottom of the
//            viewport with no way to scroll to the rest. Now top-1/2 -translate-y-1/2 anchored
//            (centers on the rail instead of growing from its top edge) with max-h-[min(70vh,26rem)]
//            overflow-y-auto. Same fix applied to the Conditions popover's chip list (max-h-40).
//            Prior: Micro-animation pass: placed blocks now animate-chip-in on an OUTER wrapper (not the
//            dnd-kit-controlled div itself — that one's `transform` is continuously overwritten
//            during drag, and a CSS animation with fill-mode:both on the same property would fight
//            it once the entrance animation completes); instrument badges chip-in on attach; the
//            empty-canvas placeholder pulses and highlights orange on drag-over instead of a flat
//            bg-color swap; ribbon items, header buttons, and the Conditions "Add" button all pick
//            up active:scale press feedback they didn't have before.
//            Prior: RIBBON_ICONS gained 5 more keys for the Tier-2/Tier-3 AI-native instrument batch (LLM
//            Rubric Grader, Cross-Answer Inconsistency, Comprehension Check, AI Devil's Advocate,
//            Adaptive Follow-Up) — no other changes needed here, same eager-glob self-registration.
//            Prior: RIBBON_ICONS gained 3 keys for the first AI-native instrument batch (Vocal Emotion
//            Trace, Sentiment-Drift Tracker, Hesitation Detector) — all attach only to Voice
//            Conversation, all is_ai=True so they render locked/undraggable same as that block.
//            Prior: Three UX fixes. Tab toggle was a rounded-full pill sized to fit "Instruments" text,
//            which made it visibly wider than the icon rail below once it went vertical — replaced
//            with two w-11 h-11 icon buttons (matching the rail exactly) with a hover flyout label,
//            same mechanic as RibbonItem. Instrument/block compatibility was previously invisible:
//            attachInstrument silently no-op'd on an incompatible drop; it now shows a toast
//            (dropError state), and the ribbon's hover flyout shows an instrument's `applies_to`
//            restriction (via new formatBlockType helper) before you even try dragging it.
//            Prior: RIBBON_ICONS gained 5 new keys for the Qualtrics-style block batch (Semantic
//            Differential, Forced Rank Order, Constant Sum, MaxDiff, Card Sort) — no other changes
//            needed here, blocks register themselves via the existing eager-glob discovery.
//            Prior: Ribbon rail now caps at RIBBON_VISIBLE_COUNT items; the rest collapse into a "…"
//            overflow popover (RibbonMenuItem — same drag/click/lock behavior, inline label instead
//            of a hover flyout). Feeds the 3 new Qualtrics-inspired instruments straight into overflow.
//            Prior: Studio-wide AI badge + visual-only paywall: any block/instrument spec with `is_ai: true`
//            (currently just the new Voice Conversation block) renders a lock chip in the ribbon,
//            is undraggable, and clicking it opens an upgrade nudge (upgradeSpec state) instead of
//            adding it — no real billing/entitlement behind this yet, purely UI.
//            Prior: Ribbon re-docked left-side vertical, Photoshop-toolbar style: icon-only items,
//            hover reveals the label as a flyout chip instead of a permanent under-icon caption.
//            Prior: Phase 3: instruments can now carry a ConfigEditor (e.g. Attention Check's expected-
//            option dropdown, Read-Time Gate's seconds input), rendered inline next to the badge
//            and wired to a new onInstrumentConfigChange handler that flows through the same
//            autosave PUT as everything else. getInstrumentComponent -> getInstrumentBadge/
//            getInstrumentConfigEditor, matching the registry's {Badge, ConfigEditor, ...} shape.
//            Prior: Phase 2: the ribbon gained an Instruments tab. Dragging an instrument icon onto
//            a placed block attaches it (the exact gesture from the original product brainstorm); a
//            badge shows on the block with a remove control. Instrument ribbon items are drag-only
//            — unlike blocks, there's no unambiguous "click to append" target without a block-
//            selection concept this phase doesn't have, so that's a known, deliberate gap.
//            Prior: Phase 1: added Publish/unpublish + copy public-link UI, and a "Responses" link
//            to the new results page. Publishing just PUTs status:'published' (already supported
//            since Phase 0's save endpoint) — this is the first place the UI actually triggers it.
//            Prior: New file: the Studio canvas builder — dotted-grid canvas, bottom-center orange/
//            white ribbon of block types (drag OR click to add, via dnd-kit), reorder placed blocks
//            by dragging them, debounced autosave to PUT /studio/projects/:id.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  DndContext, useDraggable, useDroppable, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  FaArrowLeft, FaFont, FaDotCircle, FaToggleOn, FaParagraph, FaStar, FaAlignLeft, FaStopwatch,
  FaSlidersH, FaHourglassHalf, FaRandom, FaShieldAlt, FaMicrophone, FaLock,
  FaClipboardCheck, FaTachometerAlt, FaFilter,
  FaBalanceScale, FaListOl, FaCoins, FaExchangeAlt, FaThLarge, FaUsers, FaTimes,
  FaSmile, FaChartLine, FaCommentDots,
  FaGraduationCap, FaNotEqual, FaQuestionCircle, FaComments, FaSearchPlus, FaQrcode,
  FaTrash, FaGripVertical, FaSpinner, FaSquare, FaLink, FaCheck, FaChartBar, FaRegCopy, FaCodeBranch,
} from 'react-icons/fa';
import apiClient from '../api/apiClient';
import { getBlockComponent } from '../studio/blocks/registry';
import { getInstrumentBadge } from '../studio/instruments/registry';
import BlockInspector from '../studio/BlockInspector';
import {
  BLOCK_CATEGORIES, INSTRUMENT_CATEGORIES, BLOCK_DESCRIPTIONS, groupSpecs,
} from '../studio/categories';
import { resolvePipes } from '../studio/richTextFormat';
import { LOGIC_OPS } from '../studio/blockRules';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";
const AUTOSAVE_DELAY_MS = 900;

// Maps a block/instrument spec's `icon` key (from the backend catalog) to a
// react-icons component. Falls back to a generic square so an unmapped
// future type still renders something in the ribbon instead of crashing.
const RIBBON_ICONS = {
  text: FaFont, radio: FaDotCircle, toggle: FaToggleOn,
  paragraph: FaParagraph, star: FaStar, 'align-left': FaAlignLeft,
  stopwatch: FaStopwatch, slider: FaSlidersH, hourglass: FaHourglassHalf,
  shuffle: FaRandom, shield: FaShieldAlt, microphone: FaMicrophone,
  'clipboard-check': FaClipboardCheck, tachometer: FaTachometerAlt, filter: FaFilter,
  scale: FaBalanceScale, 'list-ol': FaListOl, coins: FaCoins,
  exchange: FaExchangeAlt, 'th-large': FaThLarge, link: FaLink,
  smile: FaSmile, 'chart-line': FaChartLine, 'comment-dots': FaCommentDots,
  'graduation-cap': FaGraduationCap, 'not-equal': FaNotEqual,
  'question-circle': FaQuestionCircle, comments: FaComments, 'search-plus': FaSearchPlus,
};
const iconFor = (key) => RIBBON_ICONS[key] || FaSquare;

const newId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// "single_choice" -> "Single Choice" — used both in the ribbon's compatibility
// hint and the drop-rejected toast, so an instrument's `applies_to` restriction
// (a list of block `type` strings) reads as English in both places.
const formatBlockType = (type) => type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// One category in the left rail. Icon-only (Photoshop toolbar style) with a
// hover label; clicking opens that category's flyout of blocks/instruments.
// Not draggable itself — the items inside the flyout are.
const RailCategoryButton = ({ category, active, onClick }) => {
  const Icon = category.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      aria-label={category.label}
      className={`group relative flex items-center justify-center w-11 h-11 rounded-xl transition-colors text-white ${
        active ? 'bg-white/25' : 'hover:bg-white/15'
      }`}
    >
      <Icon className="text-lg" />
      {!active && (
        <span
          className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
          style={{ backgroundColor: '#1F1F1F', color: '#FFFFFF', fontFamily: FONT_BODY }}
        >
          {category.label}
        </span>
      )}
    </button>
  );
};

// A row inside a category flyout — drag it onto the canvas (or a block, for
// instruments), or click to append a block. `spec.is_ai` items render a lock
// and aren't draggable: a visual-only paywall stub with no billing behind it
// yet, so `onLockedClick` just opens an upgrade nudge.
const RibbonMenuItem = ({ spec, description, dragSource, dragPayload, onClick, onLockedClick }) => {
  const locked = !!spec.is_ai;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `ribbon-${dragSource}-${spec.type}`,
    data: { source: dragSource, ...dragPayload },
    disabled: locked,
  });
  const Icon = iconFor(spec.icon);
  return (
    <button
      ref={setNodeRef}
      {...(locked ? {} : listeners)}
      {...(locked ? {} : attributes)}
      type="button"
      onClick={locked ? onLockedClick : onClick}
      style={{
        transform: transform ? CSS.Translate.toString(transform) : undefined,
        opacity: isDragging ? 0.4 : 1,
        fontFamily: FONT_BODY,
      }}
      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-semibold text-left transition-colors text-[#1F1F1F] ${
        locked ? 'opacity-60 cursor-pointer' : 'hover:bg-[#F0F6FB] cursor-grab active:cursor-grabbing'
      }`}
      title={locked ? `${spec.label} is an AI feature — upgrade to unlock` : (onClick ? 'Click to add, or drag onto the canvas' : 'Drag onto a block to attach')}
    >
      <Icon className="text-base shrink-0" style={{ color: '#FA6C43' }} />
      <span className="flex-1 flex flex-col leading-tight gap-0.5">
        {spec.label}
        {description && (
          <span className="text-[11px] font-normal" style={{ color: 'rgba(31,31,31,0.5)' }}>{description}</span>
        )}
        {spec.applies_to && (
          <span className="text-[10px] font-normal" style={{ color: 'rgba(31,31,31,0.45)' }}>
            {spec.applies_to.map(formatBlockType).join(', ')} only
          </span>
        )}
      </span>
      {locked && <FaLock size={10} className="shrink-0" style={{ color: 'rgba(31,31,31,0.4)' }} />}
    </button>
  );
};

// "Shown if Q2 is “Yes”" — the canvas chip for a block with display logic.
const logicSummary = (logic, numbering) => {
  const op = LOGIC_OPS.find((o) => o.op === logic.op);
  const source = numbering[logic.source_block_id] || 'a removed question';
  return `Shown if ${source} ${op?.label || ''}${op?.needsValue ? ` “${logic.value || '…'}”` : ''}`;
};

// A block already placed on the canvas — a read-only preview of exactly what
// respondents will see (the block's own respond mode, with pointer events
// off), plus a header strip with its number, chips, and duplicate/delete.
// Clicking anywhere on it selects it, which opens the settings panel.
// Draggable by its grip (reorder) and a valid drop target for instrument
// rail items (useSortable registers a droppable under the hood).
const PlacedBlock = ({
  block, label, typeLabel, numbering, selected, onSelect, onDelete, onDuplicate, onRemoveInstrument,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const Component = getBlockComponent(block.type);
  const cfg = block.config || {};

  // A block that becomes selected — most often one just added to the end of
  // a long form — is scrolled into view so its card and its settings panel
  // are on screen together. `nearest` makes this a no-op for a click.
  const nodeRef = useRef(null);
  const setRefs = (node) => { setNodeRef(node); nodeRef.current = node; };
  useEffect(() => {
    if (selected) nodeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  // Piped answers can't resolve while building — show which question each
  // one will pull from instead of the raw {{answer:…}} token.
  const pipeLabel = (id) => `[${numbering[id] || '?'} answer]`;
  const previewConfig = {
    ...cfg,
    ...(cfg.question !== undefined ? { question: resolvePipes(cfg.question, pipeLabel) } : {}),
    ...(cfg.content !== undefined ? { content: resolvePipes(cfg.content, pipeLabel) } : {}),
  };

  const style = {
    transform: transform ? CSS.Transform.toString(transform) : undefined,
    transition,
    opacity: isDragging ? 0.5 : 1,
    borderColor: selected ? '#FA6C43' : undefined,
    boxShadow: selected ? '0 0 0 3px rgba(250,108,67,0.15)' : undefined,
  };

  const chip = (text, key, tone = 'muted') => (
    <span
      key={key}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap"
      style={tone === 'orange'
        ? { backgroundColor: '#FFF1EA', color: '#FA6C43' }
        : { backgroundColor: 'rgba(31,31,31,0.05)', color: 'rgba(31,31,31,0.55)' }}
    >
      {text}
    </span>
  );

  return (
    <div
      ref={setRefs}
      style={style}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onSelect(); }}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${label} ${typeLabel} — open settings`}
      className="group relative bg-white rounded-2xl border border-gray-200 shadow-sm cursor-pointer transition-colors hover:border-gray-300 outline-none focus-visible:border-[#FA6C43]"
    >
      <div className="flex items-center gap-2 pl-1 pr-2 pt-1.5">
        <button
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="p-2 text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing touch-none"
          aria-label="Drag to reorder"
        >
          <FaGripVertical size={12} />
        </button>
        <span className="text-[11px] font-bold" style={{ color: '#FA6C43', fontFamily: FONT_BODY }}>{label}</span>
        <span className="text-[11px] font-medium truncate" style={{ color: 'rgba(31,31,31,0.45)', fontFamily: FONT_BODY }}>{typeLabel}</span>
        <span className="flex items-center gap-1 min-w-0 overflow-hidden" style={{ fontFamily: FONT_BODY }}>
          {cfg.required && chip('Required', 'req', 'orange')}
          {cfg.display_logic && chip(<><FaCodeBranch size={8} />{logicSummary(cfg.display_logic, numbering)}</>, 'logic')}
        </span>
        <span className="ml-auto flex items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
            className="p-2 text-gray-300 hover:text-gray-600 transition-colors"
            aria-label="Duplicate block"
            title="Duplicate"
          >
            <FaRegCopy size={12} />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-2 text-gray-300 hover:text-red-500 transition-colors"
            aria-label="Delete block"
            title="Delete"
          >
            <FaTrash size={11} />
          </button>
        </span>
      </div>

      {/* Keyed on the config so blocks that compute state once per mount
          (MaxDiff's rounds) re-render the preview after every edit. */}
      <div className="pointer-events-none select-none -mt-1" aria-hidden="true">
        {Component ? (
          <Component key={JSON.stringify(previewConfig)} config={previewConfig} mode="respond" blockId={`preview-${block.id}`} onAnswer={() => {}} preview />
        ) : (
          <div className="p-4 text-sm text-red-500">Unknown block type: {block.type}</div>
        )}
      </div>

      {block.instruments?.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3 -mt-1" onClick={(e) => e.stopPropagation()}>
          {block.instruments.map((inst) => {
            const Badge = getInstrumentBadge(inst.type);
            return Badge ? <Badge key={inst.id} onRemove={() => onRemoveInstrument(inst.type)} /> : null;
          })}
        </div>
      )}
    </div>
  );
};

// The canvas is a droppable zone (for new blocks dragged from the rail)
// wrapping a sortable list (for reordering blocks already placed). A click on
// the empty background clears the selection, closing the settings panel.
const Canvas = ({
  blocks, numbering, specByType, selectedId, onSelect, onDeselect, onBlockDelete, onBlockDuplicate, onRemoveInstrument,
}) => {
  const { setNodeRef, isOver } = useDroppable({ id: 'canvas-dropzone' });

  return (
    <div
      ref={setNodeRef}
      onClick={(e) => { if (e.target === e.currentTarget || e.target.dataset.canvasBg) onDeselect(); }}
      className="flex-1 min-w-0 overflow-y-auto pl-24 pr-6 lg:pr-10 py-10"
      style={{
        backgroundImage: 'radial-gradient(rgba(31,31,31,0.12) 1px, transparent 1px)',
        backgroundSize: '20px 20px',
        backgroundColor: isOver ? '#FFF7F3' : '#F7F8FA',
        transition: 'background-color 150ms ease',
      }}
    >
      <div data-canvas-bg="1" className="max-w-2xl mx-auto flex flex-col gap-4 pb-40">
        {blocks.length === 0 ? (
          <div
            className="rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-1 py-20 text-sm text-center px-6 transition-colors duration-150"
            style={{
              borderColor: isOver ? '#FA6C43' : 'rgba(31,31,31,0.15)',
              color: isOver ? '#FA6C43' : 'rgba(31,31,31,0.4)',
              fontFamily: FONT_BODY,
            }}
          >
            <span className="font-semibold">Add your first block</span>
            <span className="text-xs">Pick a category on the left, then click a block or drag it here.</span>
          </div>
        ) : (
          <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
            {blocks.map((block) => (
              <PlacedBlock
                key={block.id}
                block={block}
                label={numbering[block.id] || 'Text'}
                typeLabel={specByType[block.type]?.label || formatBlockType(block.type)}
                numbering={numbering}
                selected={block.id === selectedId}
                onSelect={() => onSelect(block.id)}
                onDelete={() => onBlockDelete(block.id)}
                onDuplicate={() => onBlockDuplicate(block.id)}
                onRemoveInstrument={(instType) => onRemoveInstrument(block.id, instType)}
              />
            ))}
          </SortableContext>
        )}
      </div>
    </div>
  );
};

const StudioBuilderPage = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [blockSpecs, setBlockSpecs] = useState([]);
  const [instrumentSpecs, setInstrumentSpecs] = useState([]);
  const [ribbonTab, setRibbonTab] = useState('blocks'); // 'blocks' | 'instruments'
  const [upgradeSpec, setUpgradeSpec] = useState(null); // spec of the is_ai item that was clicked while locked
  const [openCategory, setOpenCategory] = useState(null); // key of the rail category whose flyout is open
  const [selectedBlockId, setSelectedBlockId] = useState(null); // block whose settings panel is open
  const railRef = useRef(null);
  const [dropError, setDropError] = useState(null); // toast text for a rejected instrument drop
  const dropErrorTimeoutRef = useRef(null);
  const [conditionsOpen, setConditionsOpen] = useState(false); // header's Conditions popover
  const [conditionDraft, setConditionDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const [publishing, setPublishing] = useState(false);
  const [copied, setCopied] = useState(false);
  const didMountRef = useRef(false);
  const saveTimeoutRef = useRef(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiClient.get(`/studio/projects/${projectId}`),
      apiClient.get('/studio/block-specs'),
      apiClient.get('/studio/instrument-specs'),
    ]).then(([projectRes, blockSpecsRes, instrumentSpecsRes]) => {
      if (cancelled) return;
      setProject(projectRes.data);
      setBlockSpecs(blockSpecsRes.data.blocks || []);
      setInstrumentSpecs(instrumentSpecsRes.data.instruments || []);
    }).catch(() => {
      if (!cancelled) setProject(null);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [projectId]);

  // Debounced autosave — fires AUTOSAVE_DELAY_MS after the last edit, skipped
  // on the initial load so opening a project doesn't immediately re-PUT it.
  useEffect(() => {
    if (!project) return;
    if (!didMountRef.current) { didMountRef.current = true; return; }

    setSaveState('saving');
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await apiClient.put(`/studio/projects/${projectId}`, {
          title: project.title,
          pages: project.pages,
          conditions: project.conditions || [],
        });
        setSaveState('saved');
      } catch (err) {
        setSaveState('error');
      }
    }, AUTOSAVE_DELAY_MS);

    return () => clearTimeout(saveTimeoutRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  const publicLink = `${window.location.origin}/s/${projectId}`;

  // Counterbalancing conditions — just names; the backend round-robin assigns
  // one per respondent at submit time (routes/studio_routes.py's
  // _assign_condition). No conditional-rendering engine consumes this yet —
  // it's assignment + logging only, see the Piped Text instrument's note.
  const addCondition = () => {
    const name = conditionDraft.trim();
    if (!name) return;
    setProject((prev) => ({ ...prev, conditions: [...(prev.conditions || []), name] }));
    setConditionDraft('');
  };
  const removeCondition = (idx) => {
    setProject((prev) => ({ ...prev, conditions: (prev.conditions || []).filter((_, i) => i !== idx) }));
  };

  // Publish/unpublish is a direct PUT, not routed through the debounced
  // autosave — a status flip should take effect immediately, not wait
  // AUTOSAVE_DELAY_MS behind whatever edit the professor made last.
  const handleTogglePublish = async () => {
    const nextStatus = project.status === 'published' ? 'draft' : 'published';
    setPublishing(true);
    try {
      await apiClient.put(`/studio/projects/${projectId}`, { status: nextStatus });
      setProject((prev) => ({ ...prev, status: nextStatus }));
    } catch (err) {
      setSaveState('error');
    } finally {
      setPublishing(false);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // Clipboard permission denied or unavailable — the link is still
      // visible in the title attribute / could be selected manually.
    }
  };

  const page = project?.pages?.[0];
  // Memoized so attachInstrument's useCallback (which reads `blocks` to check
  // applies_to compatibility) doesn't get a new identity every render.
  const blocks = useMemo(() => page?.blocks || [], [page]);

  const updatePageBlocks = useCallback((updater) => {
    setProject((prev) => {
      if (!prev) return prev;
      const nextPages = [...prev.pages];
      nextPages[0] = { ...nextPages[0], blocks: updater(nextPages[0].blocks) };
      return { ...prev, pages: nextPages };
    });
  }, []);

  // Adding a block selects it, so its settings panel opens straight away.
  const appendBlock = useCallback((spec) => {
    const id = newId('blk');
    updatePageBlocks((blks) => [
      ...blks,
      { id, type: spec.type, config: structuredClone(spec.default_config || {}), instruments: [] },
    ]);
    setSelectedBlockId(id);
  }, [updatePageBlocks]);

  // Inserts a copy right below the original and selects it. Ids are fresh,
  // and the variable name is cleared — export names must stay unique.
  const duplicateBlock = useCallback((blockId) => {
    const copyId = newId('blk');
    updatePageBlocks((blks) => {
      const idx = blks.findIndex((b) => b.id === blockId);
      if (idx === -1) return blks;
      const src = blks[idx];
      const config = structuredClone(src.config || {});
      if (config.variable_name) config.variable_name = '';
      const copy = {
        ...src,
        id: copyId,
        config,
        instruments: (src.instruments || []).map((i) => ({ ...i, id: newId('inst'), config: structuredClone(i.config || {}) })),
      };
      return [...blks.slice(0, idx + 1), copy, ...blks.slice(idx + 1)];
    });
    setSelectedBlockId(copyId);
  }, [updatePageBlocks]);

  const handleBlockChange = (blockId, newConfig) => {
    updatePageBlocks((blks) => blks.map((b) => (b.id === blockId ? { ...b, config: newConfig } : b)));
  };

  const handleBlockDelete = (blockId) => {
    updatePageBlocks((blks) => blks.filter((b) => b.id !== blockId));
    setSelectedBlockId((cur) => (cur === blockId ? null : cur));
  };

  // "Q1", "Q2", … over answerable blocks only (Instructions aren't questions).
  // Shared by the canvas labels and every picker in the settings panel.
  const numbering = useMemo(() => {
    const out = {};
    let n = 0;
    blocks.forEach((b) => { if ('required' in (b.config || {})) { n += 1; out[b.id] = `Q${n}`; } });
    return out;
  }, [blocks]);

  const specByType = useMemo(() => Object.fromEntries(blockSpecs.map((sp) => [sp.type, sp])), [blockSpecs]);
  const railGroups = useMemo(() => (
    ribbonTab === 'blocks'
      ? groupSpecs(blockSpecs, BLOCK_CATEGORIES)
      : groupSpecs(instrumentSpecs, INSTRUMENT_CATEGORIES)
  ), [ribbonTab, blockSpecs, instrumentSpecs]);
  const selectedBlock = blocks.find((b) => b.id === selectedBlockId) || null;

  // A click anywhere outside the rail closes its flyout. Escape closes the
  // flyout first, then the settings panel.
  useEffect(() => {
    if (!openCategory) return undefined;
    const onDown = (e) => { if (railRef.current && !railRef.current.contains(e.target)) setOpenCategory(null); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [openCategory]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (openCategory) setOpenCategory(null);
      else setSelectedBlockId(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openCategory]);

  // Checked *before* calling updatePageBlocks (rather than filtered out
  // inside its map, as before) specifically so an incompatible drop can
  // surface a toast instead of just doing nothing — that silent no-op was
  // confusing enough to be its own bug report.
  const attachInstrument = useCallback((spec, targetBlockId) => {
    const targetBlock = blocks.find((b) => b.id === targetBlockId);
    if (!targetBlock) return;
    if (spec.applies_to && !spec.applies_to.includes(targetBlock.type)) {
      if (dropErrorTimeoutRef.current) clearTimeout(dropErrorTimeoutRef.current);
      setDropError(`${spec.label} only works on ${spec.applies_to.map(formatBlockType).join(', ')} blocks`);
      dropErrorTimeoutRef.current = setTimeout(() => setDropError(null), 3000);
      return;
    }
    if ((targetBlock.instruments || []).some((i) => i.type === spec.type)) return; // already attached

    updatePageBlocks((blks) => blks.map((b) => (
      b.id === targetBlockId
        ? { ...b, instruments: [...(b.instruments || []), { id: newId('inst'), type: spec.type, config: { ...spec.default_config } }] }
        : b
    )));
  }, [blocks, updatePageBlocks]);

  const handleRemoveInstrument = (blockId, instrumentType) => {
    updatePageBlocks((blks) => blks.map((b) => (
      b.id === blockId ? { ...b, instruments: (b.instruments || []).filter((i) => i.type !== instrumentType) } : b
    )));
  };

  const handleInstrumentConfigChange = (blockId, instrumentType, newConfig) => {
    updatePageBlocks((blks) => blks.map((b) => (
      b.id === blockId
        ? { ...b, instruments: (b.instruments || []).map((i) => (i.type === instrumentType ? { ...i, config: newConfig } : i)) }
        : b
    )));
  };

  const handleDragEnd = ({ active, over }) => {
    setOpenCategory(null); // any drag out of a rail flyout closes it, success or not
    if (!over) return;

    if (active.data.current?.source === 'ribbon-block') {
      // Dropped a ribbon item anywhere on the canvas (the empty dropzone, or
      // on top of an existing block) — always appends to the end. Precise
      // mid-list insertion during a cross-container drag is real added
      // complexity; reordering the freshly-added block afterward (drag on
      // its own grip handle) covers "put it exactly where I want."
      const spec = blockSpecs.find((s) => s.type === active.data.current.blockType);
      if (!spec) return;
      const isOverCanvas = over.id === 'canvas-dropzone' || blocks.some((b) => b.id === over.id);
      if (isOverCanvas) appendBlock(spec);
      return;
    }

    if (active.data.current?.source === 'ribbon-instrument') {
      // Dropped an instrument icon onto a specific placed block — attaches
      // it there. Dropping on the empty dropzone (no block under the
      // pointer) is a no-op; there's nothing to attach an instrument to.
      const spec = instrumentSpecs.find((s) => s.type === active.data.current.instrumentType);
      if (!spec) return;
      const targetBlock = blocks.find((b) => b.id === over.id);
      if (targetBlock) attachInstrument(spec, targetBlock.id);
      return;
    }

    // Reordering an already-placed block.
    if (active.id !== over.id) {
      const oldIndex = blocks.findIndex((b) => b.id === active.id);
      const newIndex = blocks.findIndex((b) => b.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      updatePageBlocks((blks) => arrayMove(blks, oldIndex, newIndex));
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7F8FA]">
        <FaSpinner className="animate-spin text-2xl text-gray-400" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F7F8FA] gap-3">
        <p className="text-gray-500">Couldn&rsquo;t load that project.</p>
        <button onClick={() => navigate('/studio')} className="text-sm font-semibold" style={{ color: '#FA6C43' }}>
          Back to Studio
        </button>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="h-screen flex flex-col" style={{ fontFamily: FONT_BODY }}>
        <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200 z-10">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => navigate('/studio')}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
              aria-label="Back to Studio"
            >
              <FaArrowLeft />
            </button>
            <input
              value={project.title}
              onChange={(e) => setProject((prev) => ({ ...prev, title: e.target.value }))}
              className="font-bold text-[15px] bg-transparent outline-none min-w-0"
              style={{ color: '#1F1F1F', fontFamily: FONT_BODY }}
            />
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-gray-400 font-medium">
              {saveState === 'saving' && 'Saving…'}
              {saveState === 'saved' && 'Saved'}
              {saveState === 'error' && <span className="text-red-500">Couldn&rsquo;t save</span>}
            </span>

            <button
              onClick={() => navigate(`/studio/${projectId}/present`)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all active:scale-95"
              style={{ backgroundColor: '#FFF1EA', color: '#FA6C43' }}
              title="Open the live QR + results screen for class"
            >
              <FaQrcode size={13} />
              Present
            </button>

            <button
              onClick={() => navigate(`/studio/${projectId}/responses`)}
              className="flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-700 transition-transform active:scale-95"
            >
              <FaChartBar size={13} />
              Responses
            </button>

            <div className="relative">
              <button
                onClick={() => setConditionsOpen((open) => !open)}
                className="flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-700 transition-transform active:scale-95"
              >
                <FaUsers size={13} />
                Conditions{project.conditions?.length > 0 ? ` (${project.conditions.length})` : ''}
              </button>

              {conditionsOpen && (
                <div
                  className="absolute right-0 top-full mt-2 w-64 rounded-2xl shadow-xl bg-white border border-gray-100 p-3 z-30 animate-chip-in"
                  style={{ fontFamily: FONT_BODY }}
                >
                  <p className="text-[11px] mb-2" style={{ color: 'rgba(31,31,31,0.5)' }}>
                    Respondents are round-robin assigned one of these when they submit. No effect on
                    what they see yet — for briefing sections differently, or filtering results.
                  </p>
                  <div className="flex flex-col gap-1 mb-2 max-h-40 overflow-y-auto">
                    {(project.conditions || []).map((c, idx) => (
                      <div key={idx} className="flex items-center gap-2 px-2 py-1 rounded-lg bg-[#F7F8FA] text-sm" style={{ color: '#1F1F1F' }}>
                        <span className="flex-1 truncate">{c}</span>
                        <button type="button" onClick={() => removeCondition(idx)} aria-label={`Remove ${c}`}>
                          <FaTimes size={9} style={{ color: 'rgba(31,31,31,0.4)' }} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={conditionDraft}
                      onChange={(e) => setConditionDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCondition(); } }}
                      placeholder="Condition name…"
                      className="flex-1 px-2 py-1.5 rounded-md border text-sm"
                      style={{ borderColor: 'rgba(31,31,31,0.15)', color: '#1F1F1F' }}
                    />
                    <button
                      type="button"
                      onClick={addCondition}
                      className="px-2.5 py-1.5 rounded-md text-sm font-semibold transition-transform active:scale-95"
                      style={{ backgroundColor: '#FA6C43', color: '#FFFFFF' }}
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}
            </div>

            {project.status === 'published' && (
              <button
                onClick={handleCopyLink}
                title={publicLink}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-all active:scale-95"
              >
                {copied ? <FaCheck size={12} className="animate-chip-in" style={{ color: '#1E7A3D' }} /> : <FaLink size={12} />}
                {copied ? 'Copied' : 'Copy link'}
              </button>
            )}

            <button
              onClick={handleTogglePublish}
              disabled={publishing}
              className="px-4 py-1.5 rounded-lg text-sm font-bold transition-all active:scale-95 disabled:opacity-60"
              style={
                project.status === 'published'
                  ? { backgroundColor: '#F0F0F0', color: '#6B6B6B' }
                  : { backgroundColor: '#FA6C43', color: '#FFFFFF' }
              }
            >
              {publishing ? <FaSpinner className="animate-spin" /> : project.status === 'published' ? 'Unpublish' : 'Publish'}
            </button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          <Canvas
            blocks={blocks}
            numbering={numbering}
            specByType={specByType}
            selectedId={selectedBlockId}
            onSelect={setSelectedBlockId}
            onDeselect={() => setSelectedBlockId(null)}
            onBlockDelete={handleBlockDelete}
            onBlockDuplicate={duplicateBlock}
            onRemoveInstrument={handleRemoveInstrument}
          />

          {selectedBlock && (
            <BlockInspector
              key={selectedBlock.id}
              block={selectedBlock}
              blocks={blocks}
              numbering={numbering}
              spec={specByType[selectedBlock.type]}
              instrumentSpecs={instrumentSpecs}
              iconFor={iconFor}
              onChange={(cfg) => handleBlockChange(selectedBlock.id, cfg)}
              onClose={() => setSelectedBlockId(null)}
              onDelete={() => handleBlockDelete(selectedBlock.id)}
              onDuplicate={() => duplicateBlock(selectedBlock.id)}
              onAttachInstrument={(spec) => attachInstrument(spec, selectedBlock.id)}
              onRemoveInstrument={(type) => handleRemoveInstrument(selectedBlock.id, type)}
              onInstrumentConfigChange={(type, cfg) => handleInstrumentConfigChange(selectedBlock.id, type, cfg)}
              onLockedInstrument={setUpgradeSpec}
            />
          )}
        </div>

        {/* Left-side vertical ribbon — brand orange, white icons. Blocks | Instruments tabs. */}
        <div ref={railRef} className="fixed left-6 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-2">
          <div className="flex flex-col items-center gap-0.5 p-0.5 rounded-2xl" style={{ backgroundColor: 'rgba(31,31,31,0.08)' }}>
            <button
              type="button"
              onClick={() => { setRibbonTab('blocks'); setOpenCategory(null); }}
              className="group relative flex items-center justify-center w-11 h-11 rounded-xl transition-colors"
              style={
                ribbonTab === 'blocks'
                  ? { backgroundColor: '#FA6C43', color: '#FFFFFF' }
                  : { color: 'rgba(31,31,31,0.5)' }
              }
            >
              <FaThLarge className="text-base" />
              <span
                className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
                style={{ backgroundColor: '#1F1F1F', color: '#FFFFFF', fontFamily: FONT_BODY }}
              >
                Blocks
              </span>
            </button>
            <button
              type="button"
              onClick={() => { setRibbonTab('instruments'); setOpenCategory(null); }}
              className="group relative flex items-center justify-center w-11 h-11 rounded-xl transition-colors"
              style={
                ribbonTab === 'instruments'
                  ? { backgroundColor: '#FA6C43', color: '#FFFFFF' }
                  : { color: 'rgba(31,31,31,0.5)' }
              }
            >
              <FaSlidersH className="text-base" />
              <span
                className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
                style={{ backgroundColor: '#1F1F1F', color: '#FFFFFF', fontFamily: FONT_BODY }}
              >
                Instruments
              </span>
            </button>
          </div>
          {/* One icon per category; its flyout lists that category's items.
              No overflow scrolling in the flyout on purpose — dnd-kit drags the
              item element itself, and a scroll container would clip it. */}
          <div className="relative flex flex-col items-center gap-1 px-2 py-3 rounded-2xl shadow-lg" style={{ backgroundColor: '#FA6C43' }}>
            {railGroups.map((group) => (
              <RailCategoryButton
                key={group.key}
                category={group}
                active={openCategory === group.key}
                onClick={() => setOpenCategory((cur) => (cur === group.key ? null : group.key))}
              />
            ))}

            {(() => {
              const group = railGroups.find((g) => g.key === openCategory);
              if (!group) return null;
              const isBlocks = ribbonTab === 'blocks';
              return (
                <div
                  className="absolute left-full top-1/2 -translate-y-1/2 ml-2 w-64 rounded-2xl shadow-xl bg-white border border-gray-100 p-1.5 animate-in fade-in duration-150"
                  style={{ fontFamily: FONT_BODY }}
                >
                  <p className="px-3 pt-1.5 pb-1 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'rgba(31,31,31,0.4)' }}>
                    {group.label}
                  </p>
                  {group.specs.map((spec) => (
                    <RibbonMenuItem
                      key={spec.type}
                      spec={spec}
                      description={isBlocks ? BLOCK_DESCRIPTIONS[spec.type] : undefined}
                      dragSource={isBlocks ? 'ribbon-block' : 'ribbon-instrument'}
                      dragPayload={isBlocks ? { blockType: spec.type } : { instrumentType: spec.type }}
                      onClick={isBlocks ? () => { appendBlock(spec); setOpenCategory(null); } : undefined}
                      onLockedClick={() => { setUpgradeSpec(spec); setOpenCategory(null); }}
                    />
                  ))}
                  {!isBlocks && (
                    <p className="px-3 pt-1 pb-1.5 text-[11px] leading-snug" style={{ color: 'rgba(31,31,31,0.45)' }}>
                      Drag onto a block, or attach from a block&rsquo;s Instruments tab.
                    </p>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Visual-only paywall nudge for is_ai ribbon items — no real billing/entitlement
            check behind this yet, it just blocks the add-to-canvas gesture with an upsell. */}
        {upgradeSpec && (
          <div
            className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 px-4 animate-chip-in"
            onClick={() => setUpgradeSpec(null)}
          >
            <div
              className="bg-slate-900 text-white rounded-2xl p-6 max-w-sm flex items-start gap-4 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <FaLock className="w-5 h-5 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">{upgradeSpec.label} is an AI feature.</p>
                <p className="mt-1 text-slate-300 text-sm">
                  AI-powered blocks and instruments are part of the upcoming Pro plan. Upgrade to add
                  this to your project.
                </p>
                <button
                  type="button"
                  onClick={() => setUpgradeSpec(null)}
                  className="inline-block mt-4 px-4 py-2 rounded-lg bg-white text-slate-900 text-sm font-medium"
                >
                  Got it
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Feedback for a rejected instrument drop — previously a silent no-op, see attachInstrument. */}
        {dropError && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 animate-chip-in">
            <div
              className="px-4 py-2.5 rounded-xl shadow-lg text-sm font-semibold"
              style={{ backgroundColor: '#1F1F1F', color: '#FFFFFF', fontFamily: FONT_BODY }}
            >
              {dropError}
            </div>
          </div>
        )}
      </div>
    </DndContext>
  );
};

export default StudioBuilderPage;
