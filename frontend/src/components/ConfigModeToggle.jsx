// @language  JavaScript (React / JSX)
// @updated   2026-07-19
// @changed   Add a compact S⚬A variant (small switch + letters) for the create-modal footer.
import React from 'react';
import { FiSliders } from 'react-icons/fi';
import useConfigMode from '../hooks/useConfigMode';

// Compact Simple/Advanced switch: a small iOS-style toggle flanked by an "S" and
// an "A" letter, the active side lit brand-orange. Built for tight spots (the
// create modal's footer) where the full segmented pill is too wide. Same shared
// useConfigMode state as the pill, so both stay in lockstep. The knob slides on
// toggle and the whole control fades in + dips on press per the house animation
// convention.
function CompactToggle({ advanced, setMode, className }) {
  const letter = (active) =>
    `text-[11px] font-bold leading-none transition-colors duration-300 ${active ? 'text-[#FA6C43]' : 'text-gray-400'}`;

  return (
    <div
      role="switch"
      aria-checked={advanced}
      aria-label="Toggle advanced configuration mode"
      onClick={() => setMode(advanced ? 'simple' : 'advanced')}
      className={`animate-in fade-in duration-300 inline-flex items-center gap-1.5 select-none cursor-pointer active:scale-[0.96] transition-transform ${className}`}
    >
      <span className={letter(!advanced)}>S</span>
      <span className={`relative h-4 w-7 rounded-full transition-colors duration-300 ${advanced ? 'bg-[#FA6C43]' : 'bg-gray-300'}`}>
        {/* Sliding knob — glides to the "A" side when advanced. */}
        <span className={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform duration-300 ease-out ${advanced ? 'translate-x-3' : 'translate-x-0'}`} />
      </span>
      <span className={letter(advanced)}>A</span>
    </div>
  );
}

// Segmented Simple/Advanced switch. A single sliding pill (translate-x) glides
// under the active label on toggle; the whole control does a subtle entry fade
// and a hover lift. Reads/writes the shared faculty preference via useConfigMode,
// so placing it in the navbar keeps the create/edit forms in lockstep.
// Segments are a fixed 7rem (w-28) wide so the highlight lines up exactly.
// `variant="compact"` swaps in the small S⚬A switch for tight footers.
export default function ConfigModeToggle({ className = '', variant = 'full' }) {
  const { advanced, setMode } = useConfigMode();

  if (variant === 'compact') {
    return <CompactToggle advanced={advanced} setMode={setMode} className={className} />;
  }

  return (
    <div className={`animate-in fade-in slide-in-from-top-1 duration-300 ${className}`}>
      <div
        role="switch"
        aria-checked={advanced}
        aria-label="Toggle advanced configuration mode"
        onClick={() => setMode(advanced ? 'simple' : 'advanced')}
        className="relative inline-flex items-center select-none cursor-pointer rounded-full bg-gray-100 border border-gray-200 p-1 shadow-sm transition-all duration-200 hover:shadow-md active:scale-[0.97]"
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
