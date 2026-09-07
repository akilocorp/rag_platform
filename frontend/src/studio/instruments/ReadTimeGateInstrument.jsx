// @language JavaScript (React / JSX)
// @updated   2026-09-07
// @changed   New file: the Read-Time Gate instrument. Badge + a ConfigEditor (seconds input) for
//            the builder; the actual gating logic (disabling Submit) lives in StudioRunnerPage,
//            since it's a page-wide effect, not something this per-block UI can express on its own.
import React from 'react';
import { FaHourglassHalf, FaTimes } from 'react-icons/fa';
import { registerInstrument } from './registry';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

const Badge = ({ onRemove }) => (
  <span
    className="inline-flex items-center gap-1 pl-2 pr-1.5 py-1 rounded-full text-[11px] font-semibold"
    style={{ backgroundColor: '#F4ECD8', color: '#A8832D', fontFamily: FONT_BODY }}
  >
    <FaHourglassHalf size={10} />
    Read-Time Gate
    <button
      type="button"
      onClick={onRemove}
      className="ml-0.5 opacity-40 hover:opacity-100 transition-opacity"
      aria-label="Remove Read-Time Gate"
    >
      <FaTimes size={9} />
    </button>
  </span>
);

const ConfigEditor = ({ config, onChange }) => (
  <label className="inline-flex items-center gap-1.5 text-xs" style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.6)' }}>
    Min.
    <input
      type="number"
      min={1}
      max={120}
      value={config?.seconds ?? 5}
      onChange={(e) => onChange({ ...config, seconds: Number(e.target.value) })}
      className="w-14 px-1.5 py-1 rounded-md border text-xs"
      style={{ borderColor: 'rgba(31,31,31,0.15)', color: '#1F1F1F' }}
    />
    sec before Submit
  </label>
);

registerInstrument('read_time_gate', { Badge, ConfigEditor });

export default Badge;
