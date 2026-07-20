import React from 'react';
import { FiInfo } from 'react-icons/fi';

// Small inline info icon that reveals an explanatory tooltip on hover/focus.
// Pure CSS (group-hover / group-focus-within) — no portal, no state. Focusable
// for keyboard users via tabIndex. The tooltip fades + rises slightly on reveal
// (subtle micro-animation, consistent with the rest of the UI).
//
// `align` controls horizontal anchoring relative to the icon. Default 'center'
// keeps the tip centered; 'left' anchors its left edge to the icon so a wide tip
// next to a left-edge label expands rightward instead of overflowing (and being
// clipped by) an `overflow-hidden` ancestor.
const InfoTip = ({ text, className = '', wide = false, align = 'center' }) => {
  const anchor = align === 'left' ? 'left-0' : 'left-1/2 -translate-x-1/2';
  return (
    <span className={`relative inline-flex group align-middle ${className}`}>
      <FiInfo
        tabIndex={0}
        role="button"
        aria-label="More information"
        className="w-3.5 h-3.5 text-gray-400 hover:text-[#FA6C43] focus:text-[#FA6C43] focus:outline-none transition-colors cursor-help"
      />
      <span
        role="tooltip"
        className={`pointer-events-none absolute ${anchor} bottom-full mb-2 ${wide ? 'w-80' : 'w-56'} rounded-lg bg-[#1F1F1F] text-white text-[11px] leading-snug font-normal normal-case tracking-normal px-3 py-2 shadow-lg opacity-0 translate-y-1 scale-95 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 group-focus-within:opacity-100 group-focus-within:translate-y-0 group-focus-within:scale-100 transition-all duration-150 ease-out z-50`}
      >
        {text}
      </span>
    </span>
  );
};

export default InfoTip;
