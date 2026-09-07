// @language JavaScript (React / JSX)
// @updated   2026-09-07
// @changed   New file: the Studio canvas builder — dotted-grid canvas, bottom-center orange/white
//            ribbon of block types (drag OR click to add, via dnd-kit), reorder placed blocks by
//            dragging them, debounced autosave to PUT /studio/projects/:id. Phase 0 scope: single
//            page, blocks only — no Instruments tab yet (nothing to attach until that registry
//            exists in a later phase), no multi-page UI (the data model already supports pages;
//            this canvas just always reads/writes pages[0] until page-tabs are built).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  DndContext, useDraggable, useDroppable, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FaArrowLeft, FaFont, FaDotCircle, FaTrash, FaGripVertical, FaSpinner, FaSquare } from 'react-icons/fa';
import apiClient from '../api/apiClient';
import { getBlockComponent } from '../studio/blocks/registry';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";
const AUTOSAVE_DELAY_MS = 900;

// Maps a block spec's `icon` key (from the backend catalog) to a react-icons
// component. Falls back to a generic square so an unmapped future block type
// still renders something in the ribbon instead of crashing.
const RIBBON_ICONS = { text: FaFont, radio: FaDotCircle };
const iconFor = (key) => RIBBON_ICONS[key] || FaSquare;

const newBlockId = () => `blk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// A block type's icon+label in the ribbon. Draggable onto the canvas; also
// clickable (appends to the end) so the builder doesn't require a pointer
// drag gesture to be usable.
const RibbonItem = ({ spec, onClick }) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `ribbon-${spec.type}`,
    data: { source: 'ribbon', blockType: spec.type },
  });
  const Icon = iconFor(spec.icon);
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      type="button"
      onClick={onClick}
      style={{
        transform: transform ? CSS.Translate.toString(transform) : undefined,
        opacity: isDragging ? 0.4 : 1,
        fontFamily: FONT_BODY,
      }}
      className="flex flex-col items-center gap-1 px-4 py-2 rounded-xl hover:bg-white/15 transition-colors text-white cursor-grab active:cursor-grabbing"
      title={`Add ${spec.label} (drag to position, or click to append)`}
    >
      <Icon className="text-lg" />
      <span className="text-[11px] font-semibold">{spec.label}</span>
    </button>
  );
};

// A block already placed on the canvas — draggable (reorder), deletable, and
// hands its own config editing off to the component registered for its type.
const PlacedBlock = ({ block, onChange, onDelete }) => {
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
            <Component config={block.config} onChange={onChange} />
          ) : (
            <div className="p-4 text-sm text-red-500">Unknown block type: {block.type}</div>
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
const Canvas = ({ blocks, onBlockChange, onBlockDelete }) => {
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
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const didMountRef = useRef(false);
  const saveTimeoutRef = useRef(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiClient.get(`/studio/projects/${projectId}`),
      apiClient.get('/studio/block-specs'),
    ]).then(([projectRes, specsRes]) => {
      if (cancelled) return;
      setProject(projectRes.data);
      setBlockSpecs(specsRes.data.blocks || []);
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
      { id: newBlockId(), type: spec.type, config: { ...spec.default_config }, instruments: [] },
    ]);
  }, [updatePageBlocks]);

  const handleBlockChange = (blockId, newConfig) => {
    updatePageBlocks((blks) => blks.map((b) => (b.id === blockId ? { ...b, config: newConfig } : b)));
  };

  const handleBlockDelete = (blockId) => {
    updatePageBlocks((blks) => blks.filter((b) => b.id !== blockId));
  };

  const handleDragEnd = ({ active, over }) => {
    if (!over) return;

    if (active.data.current?.source === 'ribbon') {
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
          <span className="text-xs text-gray-400 font-medium">
            {saveState === 'saving' && 'Saving…'}
            {saveState === 'saved' && 'Saved'}
            {saveState === 'error' && <span className="text-red-500">Couldn&rsquo;t save</span>}
          </span>
        </div>

        <Canvas blocks={blocks} onBlockChange={handleBlockChange} onBlockDelete={handleBlockDelete} />

        {/* Bottom-center ribbon — brand orange, white icons/labels. */}
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-20">
          <div className="flex items-center gap-1 px-3 py-2 rounded-2xl shadow-lg" style={{ backgroundColor: '#FA6C43' }}>
            {blockSpecs.map((spec) => (
              <RibbonItem key={spec.type} spec={spec} onClick={() => appendBlock(spec)} />
            ))}
          </div>
        </div>
      </div>
    </DndContext>
  );
};

export default StudioBuilderPage;
