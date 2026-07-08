import React from 'react';

// comparison_table — a display-only side-by-side comparison grid.
// data shape (from the backend widget contract):
//   { title?, columns: [str], rows: [{ label, cells: [str] }] }
// Non-interactive: renders a styled table; every row's cells line up 1:1 with columns.
function Renderer({ data }) {
  const columns = Array.isArray(data?.columns) ? data.columns : [];
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  if (columns.length === 0 || rows.length === 0) return null;

  return (
    <div className="mt-2 rounded-xl border border-gray-200 bg-[#F0F6FB] p-3">
      {data.title && (
        <p className="mb-2 text-sm font-semibold text-[#222]">{data.title}</p>
      )}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full border-collapse bg-white text-sm">
          <thead>
            <tr className="bg-[#FFF3EF]">
              <th className="px-3 py-2 text-left font-semibold text-[#7a2e18]" />
              {columns.map((col, i) => (
                <th key={i} className="px-3 py-2 text-left font-semibold text-[#7a2e18]">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr
                key={ri}
                className="border-t border-gray-100 transition-colors hover:bg-[#F0F6FB]"
              >
                <th scope="row" className="px-3 py-2 text-left font-semibold text-[#222]">
                  {row.label}
                </th>
                {row.cells.map((cell, ci) => (
                  <td key={ci} className="px-3 py-2 align-top text-gray-600">
                    {cell || '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default {
  id: 'comparison_table',
  label: 'Comparison table',
  interactive: false,
  Renderer,
};
