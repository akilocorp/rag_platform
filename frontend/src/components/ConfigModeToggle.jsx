// @language  JavaScript (React / JSX)
// @updated   2026-07-19
// @changed   New component: animated Simple/Advanced segmented toggle for faculty config mode.
import React from 'react';
import { FiSliders } from 'react-icons/fi';
import useConfigMode from '../hooks/useConfigMode';

// Segmented Simple/Advanced switch. A single sliding pill (translate-x) glides
// under the active label on toggle; the whole control does a subtle entry fade
// and a hover lift. Reads/writes the shared faculty preference via useConfigMode,
// so placing it in the navbar keeps the create/edit forms in lockstep.
// Segments are a fixed 7rem (w-28) wide so the highlight lines up exactly.
export default function ConfigModeToggle({ className = '' }) {
  const { advanced, setMode } = useConfigMode();

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
