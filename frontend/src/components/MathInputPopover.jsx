/**
 * @language  JavaScript (React / JSX)
 * @updated   2026-07-15
 * @changed   New MathQuill equation editor popover for the chat composer.
 */
import React, { useState, useRef, useEffect } from 'react';
import { EditableMathField, addStyles as addMathquillStyles } from 'react-mathquill';
import { FiX, FiCornerDownLeft } from 'react-icons/fi';

// MathQuill ships its own CSS that must be injected once before any math field
// renders. addStyles() is idempotent, so calling it at module load is safe even
// with multiple composer instances on the page.
addMathquillStyles();

/**
 * A small popover holding a live MathQuill field. The user builds an equation
 * visually (e.g. "1/2" -> fraction, "sqrt" -> radical); on insert we hand the
 * parent the raw LaTeX so it can splice it into the message as `$...$`. Fully
 * presentational — it owns only the in-progress LaTeX, never the message text.
 */
const MathInputPopover = ({ onInsert, onClose }) => {
  const [latex, setLatex] = useState('');
  // Two-frame mount so the entrance transition has a real start point instead
  // of snapping straight to the open state (mirrors the composer's fan pattern).
  const [open, setOpen] = useState(false);
  const mathFieldRef = useRef(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Commit the current LaTeX to the message, but ignore empty/whitespace-only
  // fields so an accidental open never injects a bare `$$`.
  const handleInsert = () => {
    const trimmed = latex.trim();
    if (!trimmed) {
      onClose();
      return;
    }
    onInsert(trimmed);
  };

  return (
    <div
      className="absolute bottom-full left-0 mb-2 z-30 w-[min(340px,80vw)] origin-bottom-left rounded-2xl bg-white border border-gray-200 shadow-[0_12px_40px_rgba(31,31,31,0.16)] p-3 transition-all duration-200 ease-out"
      style={{
        opacity: open ? 1 : 0,
        transform: open ? 'translateY(0) scale(1)' : 'translateY(6px) scale(0.96)',
      }}
    >
      <div className="flex items-center justify-between mb-2 px-0.5">
        <span className="text-xs font-semibold text-gray-500">Insert equation</span>
        <button
          onClick={onClose}
          title="Close"
          className="w-6 h-6 rounded-full flex items-center justify-center text-gray-400 hover:text-[#FA6C43] hover:bg-gray-100 transition-colors"
        >
          <FiX className="text-sm" />
        </button>
      </div>

      {/* Live MathQuill field. Enter commits, Escape cancels — so the whole
          flow stays keyboard-only without reaching for the mouse. */}
      <EditableMathField
        latex={latex}
        onChange={(field) => setLatex(field.latex())}
        mathquillDidMount={(field) => {
          mathFieldRef.current = field;
          field.focus();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); handleInsert(); }
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        }}
        className="w-full min-h-[44px] rounded-xl bg-[#F0F6FB] border border-gray-200 px-3 py-2 text-lg focus-within:border-[#FA6C43]"
      />

      <p className="text-[11px] text-gray-400 mt-1.5 px-0.5">
        Try <code className="text-gray-500">1/2</code>, <code className="text-gray-500">sqrt</code>, <code className="text-gray-500">^</code> for powers.
      </p>

      <div className="flex items-center justify-end gap-2 mt-2">
        <button
          onClick={onClose}
          className="text-xs font-medium text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleInsert}
          className="text-xs font-semibold text-white bg-[#FA6C43] hover:bg-[#e85f38] px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors active:scale-95"
        >
          <FiCornerDownLeft className="text-sm" /> Insert
        </button>
      </div>
    </div>
  );
};

export default MathInputPopover;
