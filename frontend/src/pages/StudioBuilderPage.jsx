// @language JavaScript (React / JSX)
// @updated   2026-09-08
// @changed   RIBBON_ICONS gained 5 new keys for the Qualtrics-style block batch (Semantic
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
import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  FaClipboardCheck, FaTachometerAlt, FaFilter, FaEllipsisH,
  FaBalanceScale, FaListOl, FaCoins, FaExchangeAlt, FaThLarge,
  FaTrash, FaGripVertical, FaSpinner, FaSquare, FaLink, FaCheck, FaChartBar,
} from 'react-icons/fa';
import apiClient from '../api/apiClient';
import { getBlockComponent } from '../studio/blocks/registry';
import { getInstrumentBadge, getInstrumentConfigEditor } from '../studio/instruments/registry';

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
  exchange: FaExchangeAlt, 'th-large': FaThLarge,
};
const iconFor = (key) => RIBBON_ICONS[key] || FaSquare;

// How many items show directly in the rail before the rest collapse into the
// "…" overflow popover — keeps the rail from growing past the viewport as
// more instruments/blocks get added.
const RIBBON_VISIBLE_COUNT = 6;

const newId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// A block or instrument type's icon in the ribbon. `dragSource`/`dragPayload`
// distinguish which kind is being dragged in handleDragEnd. Blocks are also
// clickable (appends to the end); instruments are drag-only (see file header).
// Icon-only by default (Photoshop toolbar style); the label is an absolutely-
// positioned flyout that fades/slides in from the icon on hover so the rail
// stays narrow while docked to the left edge.
// `spec.is_ai` items (studio-wide AI badge) render a small lock chip and are
// not draggable — this is a visual-only paywall stub, there's no billing
// behind it yet, so `onLockedClick` just opens an upgrade nudge instead of
// letting the item onto the canvas.
const RibbonItem = ({ spec, dragSource, dragPayload, onClick, onLockedClick }) => {
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
      className={`group relative flex items-center justify-center w-11 h-11 rounded-xl transition-colors text-white ${
        locked ? 'opacity-70 cursor-pointer' : 'hover:bg-white/15 cursor-grab active:cursor-grabbing'
      }`}
      title={locked ? `${spec.label} is an AI feature — upgrade to unlock` : (onClick ? `Add ${spec.label} (drag to position, or click to append)` : `Drag onto a block to attach: ${spec.label}`)}
    >
      <Icon className="text-lg" />
      {locked && (
        <span
          className="absolute -top-1 -right-1 flex items-center justify-center w-4 h-4 rounded-full shadow"
          style={{ backgroundColor: '#1F1F1F' }}
        >
          <FaLock size={7} className="text-white" />
        </span>
      )}
      <span
        className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 -translate-x-1 flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold opacity-0 shadow-lg transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100"
        style={{ backgroundColor: '#1F1F1F', color: '#FFFFFF' }}
      >
        {spec.label}
        {locked && (
          <span
            className="px-1.5 py-0.5 rounded-full text-[9px] font-bold tracking-wide"
            style={{ backgroundColor: '#FA6C43', color: '#FFFFFF' }}
          >
            AI
          </span>
        )}
      </span>
    </button>
  );
};

// A row inside the "…" overflow popover — same drag/click/lock behavior as
// RibbonItem, but the label renders inline (it's an open menu, not a hover
// flyout) since there's no narrow-rail constraint inside the popover.
const RibbonMenuItem = ({ spec, dragSource, dragPayload, onClick, onLockedClick }) => {
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
      title={locked ? `${spec.label} is an AI feature — upgrade to unlock` : undefined}
    >
      <Icon className="text-base shrink-0" style={{ color: '#FA6C43' }} />
      <span className="flex-1">{spec.label}</span>
      {locked && <FaLock size={10} className="shrink-0" style={{ color: 'rgba(31,31,31,0.4)' }} />}
    </button>
  );
};

// A block already placed on the canvas — draggable (reorder), deletable, and
// hands its own config editing off to the component registered for its type.
// Also a valid drop target for instrument ribbon items (dnd-kit's useSortable
// registers a droppable under the hood, so it accepts any active draggable in
// the same DndContext, not just other sortables).
const PlacedBlock = ({ block, onChange, onDelete, onRemoveInstrument, onInstrumentConfigChange }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const Component = getBlockComponent(block.type);

  const style = {
    transform: transform ? CSS.Transform.toString(transform) : undefined,
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="group relative bg-white rounded-2xl border border-gray-200 shadow-sm">
      <div className="flex items-start">
        <button
          {...attributes}
          {...listeners}
          className="p-3 pt-4 text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing touch-none"
          aria-label="Drag to reorder"
        >
          <FaGripVertical />
        </button>
        <div className="flex-1 min-w-0">
          {Component ? (
            <Component config={block.config} onChange={onChange} blockId={block.id} />
          ) : (
            <div className="p-4 text-sm text-red-500">Unknown block type: {block.type}</div>
          )}
          {block.instruments?.length > 0 && (
            <div className="flex flex-col gap-1.5 px-4 pb-3 -mt-1">
              {block.instruments.map((inst) => {
                const Badge = getInstrumentBadge(inst.type);
                const ConfigEditor = getInstrumentConfigEditor(inst.type);
                return (
                  <div key={inst.id} className="flex flex-wrap items-center gap-2">
                    {Badge && <Badge onRemove={() => onRemoveInstrument(inst.type)} />}
                    {ConfigEditor && (
                      <ConfigEditor
                        config={inst.config}
                        blockConfig={block.config}
                        onChange={(cfg) => onInstrumentConfigChange(inst.type, cfg)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <button
          onClick={onDelete}
          className="p-3 pt-4 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="Delete block"
        >
          <FaTrash size={13} />
        </button>
      </div>
    </div>
  );
};

// The canvas is a droppable zone (for new blocks dragged from the ribbon)
// wrapping a sortable list (for reordering blocks already placed).
const Canvas = ({ blocks, onBlockChange, onBlockDelete, onRemoveInstrument, onInstrumentConfigChange }) => {
  const { setNodeRef, isOver } = useDroppable({ id: 'canvas-dropzone' });

  return (
    <div
      ref={setNodeRef}
      className="flex-1 overflow-y-auto px-6 lg:px-10 py-10"
      style={{
        backgroundImage: 'radial-gradient(rgba(31,31,31,0.12) 1px, transparent 1px)',
        backgroundSize: '20px 20px',
        backgroundColor: isOver ? '#FFF7F3' : '#F7F8FA',
        transition: 'background-color 150ms ease',
      }}
    >
      <div className="max-w-2xl mx-auto flex flex-col gap-4 pb-40">
        {blocks.length === 0 ? (
          <div
            className="rounded-2xl border-2 border-dashed flex items-center justify-center py-20 text-sm text-center px-6"
            style={{ borderColor: 'rgba(31,31,31,0.15)', color: 'rgba(31,31,31,0.35)', fontFamily: FONT_BODY }}
          >
            Drag a block from the ribbon below to get started
          </div>
        ) : (
          <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
            {blocks.map((block) => (
              <PlacedBlock
                key={block.id}
                block={block}
                onChange={(cfg) => onBlockChange(block.id, cfg)}
                onDelete={() => onBlockDelete(block.id)}
                onRemoveInstrument={(instType) => onRemoveInstrument(block.id, instType)}
                onInstrumentConfigChange={(instType, cfg) => onInstrumentConfigChange(block.id, instType, cfg)}
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
  const [overflowOpen, setOverflowOpen] = useState(false); // ribbon's "…" popover
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
  const blocks = page?.blocks || [];

  const updatePageBlocks = useCallback((updater) => {
    setProject((prev) => {
      if (!prev) return prev;
      const nextPages = [...prev.pages];
      nextPages[0] = { ...nextPages[0], blocks: updater(nextPages[0].blocks) };
      return { ...prev, pages: nextPages };
    });
  }, []);

  const appendBlock = useCallback((spec) => {
    updatePageBlocks((blks) => [
      ...blks,
      { id: newId('blk'), type: spec.type, config: { ...spec.default_config }, instruments: [] },
    ]);
  }, [updatePageBlocks]);

  const handleBlockChange = (blockId, newConfig) => {
    updatePageBlocks((blks) => blks.map((b) => (b.id === blockId ? { ...b, config: newConfig } : b)));
  };

  const handleBlockDelete = (blockId) => {
    updatePageBlocks((blks) => blks.filter((b) => b.id !== blockId));
  };

  const attachInstrument = useCallback((spec, targetBlockId) => {
    updatePageBlocks((blks) => blks.map((b) => {
      if (b.id !== targetBlockId) return b;
      if (spec.applies_to && !spec.applies_to.includes(b.type)) return b; // not compatible, silently ignore
      if ((b.instruments || []).some((i) => i.type === spec.type)) return b; // already attached
      return {
        ...b,
        instruments: [...(b.instruments || []), { id: newId('inst'), type: spec.type, config: { ...spec.default_config } }],
      };
    }));
  }, [updatePageBlocks]);

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
    setOverflowOpen(false); // any drag from the "…" popover should close it, success or not
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
      <div className="min-h-screen flex flex-col" style={{ fontFamily: FONT_BODY }}>
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
              onClick={() => navigate(`/studio/${projectId}/responses`)}
              className="flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-700"
            >
              <FaChartBar size={13} />
              Responses
            </button>

            {project.status === 'published' && (
              <button
                onClick={handleCopyLink}
                title={publicLink}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
              >
                {copied ? <FaCheck size={12} style={{ color: '#1E7A3D' }} /> : <FaLink size={12} />}
                {copied ? 'Copied' : 'Copy link'}
              </button>
            )}

            <button
              onClick={handleTogglePublish}
              disabled={publishing}
              className="px-4 py-1.5 rounded-lg text-sm font-bold transition-colors disabled:opacity-60"
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

        <Canvas
          blocks={blocks}
          onBlockChange={handleBlockChange}
          onBlockDelete={handleBlockDelete}
          onRemoveInstrument={handleRemoveInstrument}
          onInstrumentConfigChange={handleInstrumentConfigChange}
        />

        {/* Left-side vertical ribbon — brand orange, white icons. Blocks | Instruments tabs. */}
        <div className="fixed left-6 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-2">
          <div className="flex flex-col items-center gap-0.5 p-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: 'rgba(31,31,31,0.08)' }}>
            {['blocks', 'instruments'].map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => { setRibbonTab(tab); setOverflowOpen(false); }}
                className="px-3 py-1 rounded-full capitalize transition-colors"
                style={
                  ribbonTab === tab
                    ? { backgroundColor: '#FA6C43', color: '#FFFFFF' }
                    : { color: 'rgba(31,31,31,0.5)' }
                }
              >
                {tab}
              </button>
            ))}
          </div>
          <div className="relative flex flex-col items-center gap-1 px-2 py-3 rounded-2xl shadow-lg" style={{ backgroundColor: '#FA6C43' }}>
            {(() => {
              const activeSpecs = ribbonTab === 'blocks' ? blockSpecs : instrumentSpecs;
              const visible = activeSpecs.slice(0, RIBBON_VISIBLE_COUNT);
              const overflow = activeSpecs.slice(RIBBON_VISIBLE_COUNT);
              const dragSource = ribbonTab === 'blocks' ? 'ribbon-block' : 'ribbon-instrument';
              const payloadFor = (spec) => (
                ribbonTab === 'blocks' ? { blockType: spec.type } : { instrumentType: spec.type }
              );
              const onClickFor = (spec) => (
                ribbonTab === 'blocks' ? () => { appendBlock(spec); setOverflowOpen(false); } : undefined
              );

              return (
                <>
                  {visible.map((spec) => (
                    <RibbonItem
                      key={spec.type}
                      spec={spec}
                      dragSource={dragSource}
                      dragPayload={payloadFor(spec)}
                      onClick={onClickFor(spec)}
                      onLockedClick={() => setUpgradeSpec(spec)}
                    />
                  ))}

                  {overflow.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setOverflowOpen((open) => !open)}
                      className="flex items-center justify-center w-11 h-11 rounded-xl hover:bg-white/15 transition-colors text-white"
                      title="More tools"
                      aria-expanded={overflowOpen}
                    >
                      <FaEllipsisH className="text-lg" />
                    </button>
                  )}

                  {overflowOpen && overflow.length > 0 && (
                    <div
                      className="absolute left-full top-0 ml-2 w-52 rounded-2xl shadow-xl bg-white border border-gray-100 p-1.5 animate-chip-in"
                      style={{ fontFamily: FONT_BODY }}
                    >
                      {overflow.map((spec) => (
                        <RibbonMenuItem
                          key={spec.type}
                          spec={spec}
                          dragSource={dragSource}
                          dragPayload={payloadFor(spec)}
                          onClick={onClickFor(spec)}
                          onLockedClick={() => { setUpgradeSpec(spec); setOverflowOpen(false); }}
                        />
                      ))}
                    </div>
                  )}
                </>
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
      </div>
    </DndContext>
  );
};

export default StudioBuilderPage;
