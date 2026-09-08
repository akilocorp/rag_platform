import React from 'react';

export const DEFAULT_RESPONSE_DELAY = {
  enabled: false,
  mode: 'length_based',
  min_seconds: 5,
  max_seconds: 20,
  chars_per_second: 40,
};

const numberValue = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const ResponseDelaySettings = ({ value, onChange }) => {
  const delay = { ...DEFAULT_RESPONSE_DELAY, ...(value || {}) };
  const update = (field, nextValue) => onChange({ ...delay, [field]: nextValue });

  return (
    <div className="p-5 bg-gray-50 border border-gray-100 rounded-xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <label className="block text-[13px] font-bold text-gray-800 mb-0.5">Human-like response delay</label>
          <p className="text-xs text-gray-500 font-medium">Keep the typing indicator visible before revealing the completed reply.</p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer shrink-0">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={!!delay.enabled}
            onChange={(event) => update('enabled', event.target.checked)}
          />
          <span className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#FA6C43]" />
        </label>
      </div>

      {delay.enabled && (
        <div className="mt-4 pt-4 border-t border-gray-200 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Delay mode</label>
            <select
              value={delay.mode}
              onChange={(event) => update('mode', event.target.value)}
              className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#FA6C43]"
            >
              <option value="length_based">Based on response length</option>
              <option value="random">Random range</option>
              <option value="fixed">Fixed delay</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                {delay.mode === 'fixed' ? 'Delay (seconds)' : 'Minimum (seconds)'}
              </label>
              <input
                type="number" min="0" max="60" step="1"
                value={delay.min_seconds}
                onChange={(event) => update('min_seconds', numberValue(event.target.value, 0))}
                className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#FA6C43]"
              />
            </div>
            {delay.mode !== 'fixed' && (
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Maximum (seconds)</label>
                <input
                  type="number" min={delay.min_seconds} max="60" step="1"
                  value={delay.max_seconds}
                  onChange={(event) => update('max_seconds', numberValue(event.target.value, 20))}
                  className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#FA6C43]"
                />
              </div>
            )}
          </div>

          {delay.mode === 'length_based' && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Characters per additional second</label>
              <input
                type="number" min="1" max="1000" step="1"
                value={delay.chars_per_second}
                onChange={(event) => update('chars_per_second', numberValue(event.target.value, 40))}
                className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#FA6C43]"
              />
              <p className="text-[11px] text-gray-400 mt-1.5">Delay = minimum + reply characters ÷ this value, capped at the maximum.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ResponseDelaySettings;
