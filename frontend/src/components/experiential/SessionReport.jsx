import React from 'react';

// Score breakdown + predictions for a saved run. Shared by the inline session
// view (ExperientialPage) and the standalone session page.
export default function SessionReport({ session }) {
  if (!session) return null;
  const hasBreakdown = Array.isArray(session.breakdown) && session.breakdown.length > 0;
  return (
    <div className="space-y-4">
      {hasBreakdown ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <h2 className="font-bold text-[#222] mb-3">Score breakdown</h2>
          <div className="space-y-3">
            {session.breakdown.map((b, i) => (
              <div key={i} className="border-t border-gray-100 pt-3 first:border-0 first:pt-0">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-800 text-sm">{b.key}</span>
                  <span className="text-sm tabular-nums text-gray-600">{b.score}/{b.weight}</span>
                </div>
                {b.detail && <p className="text-xs text-gray-500 mt-1">{b.detail}</p>}
                {b.feedback && <p className="text-sm text-gray-700 mt-1.5 italic">{b.feedback}</p>}
                {Array.isArray(b.rubric) && b.rubric.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {b.rubric.map((r, j) => (
                      <li key={j} className={`text-xs flex items-start gap-1.5 ${r.hit ? 'text-green-600' : 'text-gray-400'}`}>
                        <span>{r.hit ? '✓' : '✕'}</span>
                        <span>{r.r}{r.note ? ` — ${r.note}` : ''}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl p-6 text-gray-500 text-sm">
          No report yet — this run hasn’t been completed.
        </div>
      )}

      {Array.isArray(session.predictions) && session.predictions.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <h2 className="font-bold text-[#222] mb-3">Predictions</h2>
          <div className="space-y-1.5">
            {session.predictions.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-gray-700">{p.label}</span>
                <span className="text-gray-900 font-semibold">{p.call}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
