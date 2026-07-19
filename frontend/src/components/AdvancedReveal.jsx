// @language  JavaScript (React / JSX)
// @updated   2026-07-19
// @changed   New component: height+fade reveal wrapper that animates advanced config fields in/out.
import React from 'react';

// Animates its children open/closed with a CSS grid-rows trick (0fr → 1fr), so
// no measured/fixed height is needed and arbitrary content animates smoothly.
// Children stay mounted while collapsed, so their values persist in the parent
// config and still submit — flipping back to Simple never resets anything.
export default function AdvancedReveal({ show, children, className = '' }) {
  return (
    <div
      aria-hidden={!show}
      className={`grid transition-all duration-500 ease-out ${show ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'} ${className}`}
    >
      <div className="overflow-hidden min-h-0">{children}</div>
    </div>
  );
}
