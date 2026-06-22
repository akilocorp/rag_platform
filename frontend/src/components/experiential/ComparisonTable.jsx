import React from 'react';

// Growing Q1 cross-model table. One column per revealed layer; rows are the
// union of every revealed layer's tableRow keys (in first-seen order). Numeric
// cells blur until the provenance gate is satisfied (`blurNumbers`).

export default function ComparisonTable({ layers, blurNumbers = false }) {
  if (!layers.length) return null;

  // Union of row labels, preserving first-seen order across layers.
  const rowLabels = [];
  for (const l of layers) {
    for (const k of Object.keys(l.reveal.tableRow)) {
      if (!rowLabels.includes(k)) rowLabels.push(k);
    }
  }

  const shortName = (name) => name.match(/\(([^)]+)\)/)?.[1] || name;

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            <th className="text-left font-semibold text-gray-500 text-xs uppercase tracking-wide py-2 pr-3">
              Q1 deviation
            </th>
            {layers.map((l) => (
              <th key={l.id} className="text-right font-semibold text-[#b8452a] py-2 px-3 whitespace-nowrap">
                {shortName(l.name)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowLabels.map((label) => (
            <tr key={label} className="border-t border-gray-100">
              <td className="py-1.5 pr-3 text-gray-600 whitespace-nowrap">{label}</td>
              {layers.map((l) => {
                const cell = l.reveal.tableRow[label];
                return (
                  <td key={l.id} className="py-1.5 px-3 text-right tabular-nums text-gray-800">
                    {cell == null ? (
                      <span className="text-gray-300">—</span>
                    ) : (
                      <span className={blurNumbers ? 'blur-[5px] select-none' : ''}>{cell}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {blurNumbers && (
        <p className="text-[11px] text-amber-600 mt-1.5 italic">
          illustrative — calibrated, not estimated. Probe the framework to verify provenance.
        </p>
      )}
    </div>
  );
}
