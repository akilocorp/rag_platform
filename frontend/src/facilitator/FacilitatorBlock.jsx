import React from 'react';
import { getWidget } from './registry';

// Dispatches a facilitator block to its registered widget Renderer.
// `block` = { widget, data }. Unknown widget ids render nothing (forward-compatible
// with blocks produced by a newer backend widget the frontend doesn't ship yet).
// The wrapper adds a uniform entrance animation for every widget.
export default function FacilitatorBlock({ block, onSubmit, disabled }) {
  if (!block || !block.widget) return null;
  const widget = getWidget(block.widget);
  if (!widget || !widget.Renderer) return null;
  const { Renderer } = widget;
  return (
    <div className="fac-enter">
      <Renderer data={block.data} onSubmit={onSubmit} disabled={disabled} />
    </div>
  );
}

// Shown in the gap between the reply finishing and the facilitator deciding which
// widget (if any) to attach. Replaced by the real block, or cleared, when the
// result arrives.
export function FacilitatorPending() {
  return (
    <div className="fac-enter mt-2 rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="w-3.5 h-3.5 rounded-full border-2 border-gray-300 border-t-[#FA6C43] animate-spin" />
        <span className="text-xs font-medium text-gray-400">Preparing an interactive element…</span>
      </div>
      <div className="space-y-1.5">
        <div className="fac-pending-bar h-2.5 rounded w-2/3" />
        <div className="fac-pending-bar h-2.5 rounded w-1/2" />
      </div>
    </div>
  );
}
