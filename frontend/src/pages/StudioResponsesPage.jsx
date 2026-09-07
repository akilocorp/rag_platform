// @language JavaScript (React / JSX)
// @updated   2026-09-07
// @changed   New file: owner-only raw response table + CSV export for a Studio project. The CSV
//            export is a JWT-authenticated endpoint, so it can't be a plain <a href> (no way to
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

  return (
    <div className="min-h-screen bg-[#F0F6FB]" style={{ fontFamily: FONT_BODY }}>
      <div className="max-w-6xl mx-auto px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(`/studio/${projectId}`)}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-white"
              aria-label="Back to builder"
            >
              <FaArrowLeft />
            </button>
            <div>
              <h1 className="text-lg font-bold" style={{ color: '#1F1F1F' }}>
                {project?.title || 'Project'} — Responses
              </h1>
              <p className="text-sm text-gray-500">{responses.length} response{responses.length === 1 ? '' : 's'}</p>
            </div>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting || responses.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-gray-200 hover:border-[#FA6C43] hover:text-[#FA6C43] text-gray-700 text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {exporting ? <FaSpinner className="animate-spin" /> : <FaDownload />}
            Export CSV
          </button>
        </div>

        {responses.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 py-20 text-center text-gray-400 text-sm">
            No responses yet.
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-gray-400 text-xs uppercase tracking-wide">
                  <th className="px-4 py-3 font-semibold whitespace-nowrap">Respondent</th>
                  <th className="px-4 py-3 font-semibold whitespace-nowrap">Submitted</th>
                  {columns.map((blk) => (
                    <th key={blk.id} className="px-4 py-3 font-semibold min-w-[160px]">
                      {blk.config?.question || blk.id}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {responses.map((r) => {
                  const byId = {};
                  (r.answers || []).forEach((a) => { byId[a.block_id] = a.value; });
                  return (
                    <tr key={r._id} className="border-b border-gray-50 last:border-0">
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{r.respondent_id}</td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        {r.submitted_at ? new Date(r.submitted_at).toLocaleString() : ''}
                      </td>
                      {columns.map((blk) => (
                        <td key={blk.id} className="px-4 py-3" style={{ color: '#1F1F1F' }}>
                          {String(byId[blk.id] ?? '')}
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
