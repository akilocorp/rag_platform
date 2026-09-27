// @language  JavaScript (React / JSX)
// @updated   2026-09-27
// @changed   Compact variant is now a labelled "Show/Hide advanced settings" text link, not an S⚬A switch.
// @changed   Prior: Quieter motion: no press-shrink, hover shadow or slide-in; fade only.
// @changed   Prior: Add a compact S⚬A variant (small switch + letters) for the create-modal footer.
import React from 'react';
import { FiSliders } from 'react-icons/fi';
import useConfigMode from '../hooks/useConfigMode';

// Compact Simple/Advanced control for the create dialog's footer: a plain text link
// ("Show / Hide advanced settings") rather than an unlabelled S/A switch, so it says what
// it does and can't be mistaken for part of Back/Next. Same shared useConfigMode state as
// the full pill, so both stay in lockstep.
function CompactToggle({ advanced, setMode, className }) {
  return (
    <button
      type="button"
      aria-pressed={advanced}
      onClick={() => setMode(advanced ? 'simple' : 'advanced')}
      className={`inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-[#FA6C43] transition-colors ${className}`}
    >
      <FiSliders className="text-sm" />
      {advanced ? 'Hide advanced settings' : 'Show advanced settings'}
    </button>
  );
}

// Segmented Simple/Advanced switch. A single sliding pill (translate-x) glides
// under the active label on toggle; the whole control does a subtle entry fade
// and a hover lift. Reads/writes the shared faculty preference via useConfigMode,
// so placing it in the navbar keeps the create/edit forms in lockstep.
// Segments are a fixed 7rem (w-28) wide so the highlight lines up exactly.
// `variant="compact"` swaps in the text-link form for tight footers.
export default function ConfigModeToggle({ className = '', variant = 'full' }) {
  const { advanced, setMode } = useConfigMode();

  if (variant === 'compact') {
    return <CompactToggle advanced={advanced} setMode={setMode} className={className} />;
  }

  return (
    <div className={`animate-in fade-in duration-300 ${className}`}>
      <div
        role="switch"
        aria-checked={advanced}
        aria-label="Toggle advanced configuration mode"
        onClick={() => setMode(advanced ? 'simple' : 'advanced')}
        className="relative inline-flex items-center select-none cursor-pointer rounded-full bg-gray-100 border border-gray-200 p-1 shadow-sm"
      >
        {/* Sliding highlight — animates between the two 7rem segments. */}
        <span
          aria-hidden="true"
          className={`absolute top-1 bottom-1 left-1 w-28 rounded-full bg-[#FA6C43] shadow transition-transform duration-300 ease-out ${advanced ? 'translate-x-28' : 'translate-x-0'}`}
        />
        <span className={`relative z-10 w-28 text-center py-1.5 text-[13px] font-bold transition-colors duration-300 ${advanced ? 'text-gray-500' : 'text-white'}`}>
          Simple
        </span>
        <span className={`relative z-10 w-28 flex items-center justify-center gap-1.5 py-1.5 text-[13px] font-bold transition-colors duration-300 ${advanced ? 'text-white' : 'text-gray-500'}`}>
          <FiSliders className="text-xs" /> Advanced
        </span>
      </div>
    </div>
  );
}
