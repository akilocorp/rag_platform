import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaSpinner } from 'react-icons/fa';
import { RiBookOpenLine } from 'react-icons/ri';

// Positions itself near `anchorRect` (viewport coords). Tries above the
// anchor first; flips below if there's no room. Clamps to the viewport
// horizontally. Initial render is opacity 0 so the user never sees a flash
// at (0,0) before measure.
const DefinitionPopover = ({
  word,
  anchorRect,
  loading,
  definition,
  onPopoverEnter,
  onPopoverLeave,
}) => {
  const ref = useRef(null);
  const [style, setStyle] = useState({ opacity: 0, top: 0, left: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchorRect) return;
    const margin = 8;
    const popW = el.offsetWidth;
    const popH = el.offsetHeight;
    const vw = window.innerWidth;

    let top = anchorRect.top + window.scrollY - popH - margin;
    if (anchorRect.top - popH - margin < 0) {
      top = anchorRect.bottom + window.scrollY + margin;
    }
    let left = anchorRect.left + window.scrollX + anchorRect.width / 2 - popW / 2;
    const maxLeft = vw + window.scrollX - popW - margin;
    const minLeft = window.scrollX + margin;
    if (left > maxLeft) left = maxLeft;
    if (left < minLeft) left = minLeft;

    setStyle({ top, left, opacity: 1 });
  }, [anchorRect, definition, loading]);

  if (!anchorRect) return null;

  // Portal to body so position: absolute resolves against the document,
  // not against any styled ancestor (e.g. animate-in's transform creates
  // a containing block that would throw off the math).
  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      onMouseEnter={onPopoverEnter}
      onMouseLeave={onPopoverLeave}
      className="dictionary-popover relative rounded-2xl shadow-lg border border-[#D7E3F2] p-3.5 pb-7 w-64 text-[12px] leading-snug text-gray-800 pointer-events-auto"
      style={{
        position: 'absolute',
        zIndex: 60,
        transition: 'opacity 120ms ease-out',
        background: 'linear-gradient(135deg, #EAF2FB 0%, #F7FAFD 55%, #DCE9F7 100%)',
        ...style,
      }}
    >
      {loading && (
        <div className="flex items-center gap-2 text-gray-500">
          <FaSpinner className="animate-spin text-[10px]" />
          <span>looking up "{word}"…</span>
        </div>
      )}

      {!loading && definition?.error && (
        <div className="text-red-500">Lookup failed: {definition.error}</div>
      )}

      {!loading && definition?.notFound && (
        <div className="text-gray-500 italic">No definition found for "{word}".</div>
      )}

      {!loading && definition?.meanings?.length > 0 && (
        <>
          {definition.meanings[0].partOfSpeech && (
            <div className="italic text-gray-500 text-[11px] mb-1">
              {definition.meanings[0].partOfSpeech}
            </div>
          )}
          <ul className="space-y-1 text-gray-900">
            {definition.meanings[0].definitions.map((d, j) => (
              <li key={j}>{d}</li>
            ))}
          </ul>
          {definition.phonetic && (
            <div className="mt-2 text-gray-500 font-mono text-[11px]">{definition.phonetic}</div>
          )}
          {definition.meanings.slice(1).map((m, i) => (
            <div key={i} className="mt-2">
              {m.partOfSpeech && (
                <div className="italic text-gray-500 text-[11px]">{m.partOfSpeech}</div>
              )}
              <ul className="list-disc pl-4 mt-0.5 space-y-0.5">
                {m.definitions.map((d, j) => (
                  <li key={j}>{d}</li>
                ))}
              </ul>
            </div>
          ))}
          <RiBookOpenLine className="absolute bottom-2.5 right-3 text-gray-400 text-[14px]" />
        </>
      )}
    </div>,
    document.body,
  );
};

export default DefinitionPopover;
