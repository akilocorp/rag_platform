// @language  JavaScript (React / JSX)
// @updated   2026-10-04
// @changed   Hidden tooltip is display:none (not just transparent) so it can't widen the page on phones;
//            still fades in via fac-fade-in when shown, and is capped to the screen width.
// @changed   Prior: Tooltip fades in instead of scaling/rising.
import React from 'react';
import { FiInfo } from 'react-icons/fi';

// Small inline info icon that reveals an explanatory tooltip on hover/focus.
// Pure CSS (group-hover / group-focus-within) — no portal, no state. Focusable
// for keyboard users via tabIndex. The tooltip fades in on reveal — no rise or
// scale, in keeping with the quieter motion across the faculty pages.
//
// `align` controls horizontal anchoring relative to the icon. Default 'center'
// keeps the tip centered; 'left' anchors its left edge to the icon so a wide tip
// next to a left-edge label expands rightward instead of overflowing (and being
// clipped by) an `overflow-hidden` ancestor.
//
// The tip is `hidden` until hover/focus rather than opacity-0: an invisible 320px absolute
// box still counts toward the page's scroll width, which pushed whole pages past a phone
// screen. The fade survives as a keyframe that replays each time the tip is displayed.
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
        className={`pointer-events-none absolute ${anchor} bottom-full mb-2 ${wide ? 'w-80' : 'w-56'} max-w-[calc(100vw-2rem)] rounded-lg bg-[#1F1F1F] text-white text-[11px] leading-snug font-normal normal-case tracking-normal px-3 py-2 shadow-lg hidden group-hover:block group-focus-within:block z-50`}
        style={{ animation: 'fac-fade-in 150ms ease-out forwards', opacity: 0 }}
      >
        {text}
      </span>
    </span>
  );
};

export default InfoTip;
