import React from 'react';

// timeline — a display-only ordered vertical sequence of steps/events.
// data shape (from the backend widget contract): { title?, steps: [{ label, detail? }] }
// Non-interactive: renders an ordered list with a connector rail and numbered nodes.
function Renderer({ data }) {
  const steps = Array.isArray(data?.steps) ? data.steps : [];
  if (steps.length === 0) return null;

  return (
    <div className="mt-2 rounded-xl border border-gray-200 bg-[#F0F6FB] p-3">
      {data.title && (
        <p className="mb-2.5 text-sm font-semibold text-[#222]">{data.title}</p>
      )}
      <ol className="relative ml-1">
        {steps.map((s, i) => (
          <li key={i} className="group relative flex gap-3 pb-4 last:pb-0">
            {/* connector rail — hidden on the last node */}
            {i < steps.length - 1 && (
              <span className="absolute left-[11px] top-6 bottom-0 w-px bg-gray-200" aria-hidden="true" />
            )}
            {/* numbered node */}
            <span className="fac-fade-node relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#FA6C43] bg-white text-[11px] font-bold text-[#FA6C43] transition-transform group-hover:scale-110">
              {i + 1}
            </span>
            <div className="pt-0.5">
              <p className="text-sm font-semibold text-[#222]">{s.label}</p>
              {s.detail && <p className="mt-0.5 text-xs text-gray-500">{s.detail}</p>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default {
  id: 'timeline',
  label: 'Timeline',
  interactive: false,
  Renderer,
};
