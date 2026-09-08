// @language JavaScript (React / JSX)
// @updated   2026-09-08
// @changed   Micro-animation pass: table rows stagger-fade in on load (animate-chip-in + per-index
//            delay, capped at 12 rows worth of stagger so a huge response list doesn't feel slow to
//            finish appearing) with a soft hover tint; header buttons and back arrow pick up
//            active:scale press feedback; empty/loaded states fade in instead of popping.
//            Prior: Added a Condition column (only rendered if any response actually carries one — most
//            projects define no conditions) and dynamically-discovered Embedded Data columns,
//            mirroring the exact same discovery approach the metric columns already use.
//            Prior: Phase 2: added instrument-metric columns (e.g. "Question — reaction_timer:latency_ms"),
//            discovered dynamically from the responses' computed `answer.metrics` rather than
//            statically from the instrument spec — mirrors the same discovery approach in
//            routes/studio_routes.py's export_responses_csv, so a future instrument's metrics show
//            up here with no frontend changes.
//            Prior: New file: owner-only raw response table + CSV export for a Studio project. The
//            CSV export is a JWT-authenticated endpoint, so it can't be a plain <a href> (no way to
//            attach an Authorization header to a browser navigation) — fetched as a blob via
//            apiClient instead and downloaded via a throwaway object URL.
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FaArrowLeft, FaSpinner, FaDownload } from 'react-icons/fa';
import apiClient from '../api/apiClient';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

// Blocks that expect a response — mirrors backend routes/studio_routes.py's
// _answerable_blocks: anything whose config carries a `required` key.
const answerableBlocks = (project) =>
  (project?.pages || []).flatMap((p) => p.blocks || []).filter((b) => 'required' in (b.config || {}));

// [{blockId, instrumentType, metricKey, label}] — one per unique metric key
// actually seen across all responses for a given block+instrument.
const discoverMetricColumns = (responses, questionByBlock) => {
  const seen = new Set();
  const cols = [];
  responses.forEach((r) => {
    (r.answers || []).forEach((a) => {
      Object.entries(a.metrics || {}).forEach(([instrumentType, metrics]) => {
        Object.keys(metrics).forEach((metricKey) => {
          const key = `${a.block_id}::${instrumentType}::${metricKey}`;
          if (seen.has(key)) return;
          seen.add(key);
          const question = questionByBlock[a.block_id] || a.block_id;
          cols.push({ blockId: a.block_id, instrumentType, metricKey, label: `${question} — ${instrumentType}:${metricKey}` });
        });
      });
    });
  });
  return cols;
};

// Distinct embedded-data keys seen across all responses, in first-seen order
// — a project's respondents may carry different URL params over time, and
// there's no schema declaring them up front.
const discoverEmbeddedDataKeys = (responses) => {
  const seen = new Set();
  responses.forEach((r) => {
    Object.keys(r.embedded_data || {}).forEach((k) => seen.add(k));
  });
  return Array.from(seen);
};

const StudioResponsesPage = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [responses, setResponses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiClient.get(`/studio/projects/${projectId}`),
      apiClient.get(`/studio/projects/${projectId}/responses`),
    ]).then(([projectRes, responsesRes]) => {
      if (cancelled) return;
      setProject(projectRes.data);
      setResponses(responsesRes.data.responses || []);
    }).catch(() => {}).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await apiClient.get(`/studio/projects/${projectId}/responses.csv`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(project?.title || 'project').replace(/\s+/g, '_')}_responses.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      // Best-effort — the table below still shows the same data on screen.
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F0F6FB]">
        <FaSpinner className="animate-spin text-2xl text-gray-400" />
      </div>
    );
  }

  const columns = answerableBlocks(project);
  const questionByBlock = Object.fromEntries(columns.map((b) => [b.id, b.config?.question || b.id]));
  const metricColumns = discoverMetricColumns(responses, questionByBlock);
  const embeddedKeys = discoverEmbeddedDataKeys(responses);
  const hasCondition = responses.some((r) => r.condition);

  return (
    <div className="min-h-screen bg-[#F0F6FB]" style={{ fontFamily: FONT_BODY }}>
      <div className="max-w-6xl mx-auto px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(`/studio/${projectId}`)}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-white transition-all active:scale-90"
              aria-label="Back to builder"
            >
              <FaArrowLeft />
            </button>
            <div className="animate-chip-in">
              <h1 className="text-lg font-bold" style={{ color: '#1F1F1F' }}>
                {project?.title || 'Project'} — Responses
              </h1>
              <p className="text-sm text-gray-500">{responses.length} response{responses.length === 1 ? '' : 's'}</p>
            </div>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting || responses.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-gray-200 hover:border-[#FA6C43] hover:text-[#FA6C43] text-gray-700 text-sm font-semibold transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100"
          >
            {exporting ? <FaSpinner className="animate-spin" /> : <FaDownload />}
            Export CSV
          </button>
        </div>

        {responses.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 py-20 text-center text-gray-400 text-sm animate-chip-in">
            No responses yet.
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-x-auto animate-chip-in">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-gray-400 text-xs uppercase tracking-wide">
                  <th className="px-4 py-3 font-semibold whitespace-nowrap">Respondent</th>
                  <th className="px-4 py-3 font-semibold whitespace-nowrap">Submitted</th>
                  {hasCondition && <th className="px-4 py-3 font-semibold whitespace-nowrap">Condition</th>}
                  {columns.map((blk) => (
                    <th key={blk.id} className="px-4 py-3 font-semibold min-w-[160px]">
                      {blk.config?.question || blk.id}
                    </th>
                  ))}
                  {metricColumns.map((mc) => (
                    <th
                      key={`${mc.blockId}::${mc.instrumentType}::${mc.metricKey}`}
                      className="px-4 py-3 font-semibold min-w-[140px]"
                      style={{ color: '#FA6C43' }}
                    >
                      {mc.label}
                    </th>
                  ))}
                  {embeddedKeys.map((k) => (
                    <th key={`embedded::${k}`} className="px-4 py-3 font-semibold min-w-[120px] text-gray-400">
                      {k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {responses.map((r, idx) => {
                  const byId = {};
                  (r.answers || []).forEach((a) => { byId[a.block_id] = a; });
                  return (
                    <tr
                      key={r._id}
                      className="border-b border-gray-50 last:border-0 animate-chip-in hover:bg-[#FFF7F3]/60 transition-colors"
                      style={{ animationDelay: `${Math.min(idx, 12) * 25}ms` }}
                    >
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{r.respondent_id}</td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        {r.submitted_at ? new Date(r.submitted_at).toLocaleString() : ''}
                      </td>
                      {hasCondition && (
                        <td className="px-4 py-3 whitespace-nowrap" style={{ color: '#1F1F1F' }}>{r.condition || ''}</td>
                      )}
                      {columns.map((blk) => (
                        <td key={blk.id} className="px-4 py-3" style={{ color: '#1F1F1F' }}>
                          {String((byId[blk.id] || {}).value ?? '')}
                        </td>
                      ))}
                      {metricColumns.map((mc) => (
                        <td
                          key={`${mc.blockId}::${mc.instrumentType}::${mc.metricKey}`}
                          className="px-4 py-3"
                          style={{ color: '#1F1F1F' }}
                        >
                          {String((byId[mc.blockId]?.metrics || {})[mc.instrumentType]?.[mc.metricKey] ?? '')}
                        </td>
                      ))}
                      {embeddedKeys.map((k) => (
                        <td key={`embedded::${k}`} className="px-4 py-3 text-gray-500">
                          {String((r.embedded_data || {})[k] ?? '')}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default StudioResponsesPage;
