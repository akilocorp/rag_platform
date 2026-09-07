// @language JavaScript (React / JSX)
// @updated   2026-09-07
// @changed   New file: Studio project list — bare list + "New Project," Phase 0 of the faculty
//            research-project builder. Modeled loosely on ConfigList.jsx's data-fetch and
//            inline-delete-confirmation patterns, intentionally minimal (no categories/search/
//            copy-paste — those can come later if the project count ever justifies them).
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaPlus, FaSpinner, FaTrash, FaShapes } from 'react-icons/fa';
import apiClient from '../api/apiClient';
import UserInfo from '../components/UserInfo';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

const STATUS_STYLE = {
  draft: { bg: '#F4ECD8', fg: '#A8832D' },
  published: { bg: '#E6F4EA', fg: '#1E7A3D' },
  archived: { bg: '#F0F0F0', fg: '#6B6B6B' },
};

// Own component so each card's inline delete-confirmation state (`confirming`)
// doesn't force the whole list to re-render on every hover/click.
const StudioProjectCard = ({ project, onOpen, onDelete }) => {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const statusStyle = STATUS_STYLE[project.status] || STATUS_STYLE.draft;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDelete(project._id);
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  };

  return (
    <div
      onClick={() => !confirming && onOpen(project._id)}
      className="group relative bg-white rounded-2xl border border-gray-200 p-5 cursor-pointer transition-shadow hover:shadow-md flex flex-col justify-between min-h-[110px]"
    >
      {!confirming && (
        <button
          onClick={(e) => { e.stopPropagation(); setConfirming(true); }}
          title="Delete"
          className="absolute top-4 right-4 p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
          aria-label="Delete project"
        >
          <FaTrash size={13} />
        </button>
      )}

      <div>
        <h3 className="font-bold text-[15px] mb-1.5 pr-8 truncate" style={{ color: '#1F1F1F' }}>
          {project.title}
        </h3>
        <span
          className="inline-block text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
          style={{ backgroundColor: statusStyle.bg, color: statusStyle.fg }}
        >
          {project.status}
        </span>
      </div>

      {confirming && (
        <div className="flex items-center gap-2 mt-4" onClick={(e) => e.stopPropagation()}>
          <span className="text-xs font-medium text-gray-500 mr-auto">Delete this project?</span>
          <button
            onClick={() => setConfirming(false)}
            className="px-2.5 py-1 text-xs font-semibold rounded-lg text-gray-500 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-60"
          >
            {deleting ? <FaSpinner className="animate-spin" /> : 'Delete'}
          </button>
        </div>
      )}
    </div>
  );
};

const StudioListPage = () => {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiClient.get('/studio/projects')
      .then(({ data }) => { if (!cancelled) setProjects(data.projects || []); })
      .catch(() => { if (!cancelled) setError('Could not load your projects.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    setError('');
    try {
      const { data } = await apiClient.post('/studio/projects', {});
      navigate(`/studio/${data._id}`);
    } catch (err) {
      setError('Could not create a new project.');
      setCreating(false);
    }
  };

  const handleDelete = async (projectId) => {
    try {
      await apiClient.delete(`/studio/projects/${projectId}`);
      setProjects((prev) => prev.filter((p) => p._id !== projectId));
    } catch (err) {
      setError('Could not delete that project.');
    }
  };

  return (
    <div
      style={{ fontFamily: FONT_BODY }}
      className="min-h-screen bg-[#F0F6FB] text-gray-900 flex flex-col"
    >
      <nav className="w-full flex justify-between items-center px-6 lg:px-8 py-6 max-w-[1440px] mx-auto z-10">
        <div
          className="flex items-center hover:opacity-90 transition-opacity cursor-pointer"
          onClick={() => navigate('/config_list')}
        >
          <img src="/actrlabs-wordmark.png" alt="ACTRLabs" className="h-10 lg:h-12 w-auto object-contain" />
        </div>
        <div className="flex items-center space-x-6 lg:space-x-8">
          <UserInfo />
        </div>
      </nav>

      <div className="container mx-auto px-6 lg:px-8 py-4 lg:py-8 max-w-[1440px] flex-1 w-full">
        <div className="flex items-center justify-between mb-8 gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2.5" style={{ color: '#1F1F1F' }}>
              <FaShapes style={{ color: '#FA6C43' }} />
              Studio
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Build research projects — drag blocks onto a canvas, attach instruments to measure how people respond.
            </p>
          </div>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#FA6C43] hover:bg-[#E55B34] text-white rounded-xl transition-all duration-200 shadow-sm active:scale-[0.98] font-bold text-sm disabled:opacity-60"
          >
            {creating ? <FaSpinner className="animate-spin" /> : <FaPlus />}
            New Project
          </button>
        </div>

        {error && (
          <div className="mb-6 px-4 py-3 rounded-xl bg-red-50 text-red-600 text-sm">{error}</div>
        )}

        {loading ? (
          <div className="flex justify-center py-24">
            <FaSpinner className="animate-spin text-2xl text-gray-400" />
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <FaShapes className="text-4xl mb-4" style={{ color: 'rgba(31,31,31,0.15)' }} />
            <p className="text-gray-500 mb-1">No projects yet.</p>
            <p className="text-sm text-gray-400">Create one to start building a research instrument.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {projects.map((p) => (
              <StudioProjectCard
                key={p._id}
                project={p}
                onOpen={(id) => navigate(`/studio/${id}`)}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default StudioListPage;
