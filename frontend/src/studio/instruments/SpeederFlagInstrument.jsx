// @language JavaScript (React / JSX)
// @updated   2026-09-08
// @changed   New file: the Speeder Flag instrument. Badge + a ConfigEditor (threshold-seconds
//            input), mirroring Read-Time Gate's — but purely measurement, no gating logic anywhere:
//            it just reads the same shown/submit events Reaction Timer already captures and flags a
//            fast respondent in the results view.
import React from 'react';
import { FaTachometerAlt, FaTimes } from 'react-icons/fa';
import { registerInstrument } from './registryStore';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

const Badge = ({ onRemove }) => (
  <span
    className="inline-flex items-center gap-1 pl-2 pr-1.5 py-1 rounded-full text-[11px] font-semibold"
    style={{ backgroundColor: '#FDEBE0', color: '#B85C1E', fontFamily: FONT_BODY }}
  >
    <FaTachometerAlt size={10} />
    Speeder Flag
    <button
      type="button"
      onClick={onRemove}
      className="ml-0.5 opacity-40 hover:opacity-100 transition-opacity"
      aria-label="Remove Speeder Flag"
    >
      <FaTimes size={9} />
    </button>
  </span>
);

const ConfigEditor = ({ config, onChange }) => (
  <label className="inline-flex items-center gap-1.5 text-xs" style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.6)' }}>
    Faster than
    <input
      type="number"
      min={1}
      max={120}
      value={config?.threshold_seconds ?? 3}
      onChange={(e) => onChange({ ...config, threshold_seconds: Number(e.target.value) })}
      className="w-14 px-1.5 py-1 rounded-md border text-xs"
      style={{ borderColor: 'rgba(31,31,31,0.15)', color: '#1F1F1F' }}
    />
    sec = flagged
  </label>
);

registerInstrument('speeder_flag', { Badge, ConfigEditor });

export default Badge;
