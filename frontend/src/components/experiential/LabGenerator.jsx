import React, { useState } from 'react';
import { FaSpinner } from 'react-icons/fa';
import { FiZap, FiCheckCircle, FiAlertTriangle } from 'react-icons/fi';
import apiClient from '../../api/apiClient';
import { validateExperientialConfig } from '../../configs/experiential/schema';

// Generate-on-save UI for experiential labs: the professor writes a design
// prompt, hits Generate, and Claude (grounded in the config's knowledge base
// when a configId is supplied) returns a full lab config. We validate it client
// side and show a preview before the prof saves.
// Generation templates the prof can pick. "econ" keeps the opinionated macro
// spine; "generic" works for any discipline with a flexible shape.
const GEN_TEMPLATES = [
  { id: 'econ', label: 'Economics (baseline → complications)' },
  { id: 'generic', label: 'Generic (any discipline)' },
];

export default function LabGenerator({ prompt, onPromptChange, generated, onGenerated, configId }) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [grounded, setGrounded] = useState(false);
  const [template, setTemplate] = useState('econ');

  const handleGenerate = async () => {
    const p = (prompt || '').trim();
    if (!p) { setError('Write a design prompt first.'); return; }
    setGenerating(true);
    setError(null);
    try {
      const { data } = await apiClient.post('/experiential/generate', { prompt: p, template, config_id: configId || undefined });
      const { ok, errors } = validateExperientialConfig(data.config);
      if (!ok) {
        setError(`The generated lab didn't validate: ${errors.slice(0, 3).join('; ')}. Try Generate again or tweak your prompt.`);
        setGenerating(false);
        return;
      }
      setGrounded(!!data.grounded);
      onGenerated(data.config);
    } catch (e) {
      setError(e.response?.data?.error || 'Generation failed.');
    }
    setGenerating(false);
  };

  return (
    <div>
      <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Discipline template</label>
      <select
        value={template}
        onChange={(e) => setTemplate(e.target.value)}
        className="w-full mb-3 p-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all"
      >
        {GEN_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>

      <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Lab design prompt</label>
      <textarea
        value={prompt || ''}
        onChange={(e) => onPromptChange(e.target.value)}
        rows={5}
        placeholder="e.g. Teach how adding financial frictions and household heterogeneity change a baseline oil-shock response. Start from the representative-agent model students know, then add BGG and HANK. Ground it in Lectures 5–7."
        className="w-full p-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all resize-y"
      />
      <p className="text-[11px] text-gray-400 mt-1.5">
        Claude builds the full lab (scenario, a baseline plus complications, charts, table, synthesis){configId ? ' grounded in this bot’s uploaded knowledge base' : ''}. Probes are posed automatically in sequence. You review it before saving.
      </p>

      <button
        type="button"
        onClick={handleGenerate}
        disabled={generating}
        className="mt-3 inline-flex items-center gap-2 bg-[#FA6C43] hover:bg-[#e85a30] disabled:opacity-50 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
      >
        {generating ? <><FaSpinner className="animate-spin" /> Generating…</> : <><FiZap /> {generated ? 'Regenerate lab' : 'Generate lab'}</>}
      </button>

      {error && (
        <div className="mt-3 flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          <FiAlertTriangle className="mt-0.5 shrink-0" /> <span>{error}</span>
        </div>
      )}

      {generated && generated.layers && (
        <LabPreview cfg={generated} grounded={grounded} />
      )}
    </div>
  );
}

function LabPreview({ cfg, grounded }) {
  return (
    <div className="mt-4 rounded-2xl border border-green-200 bg-green-50/40 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-green-700 mb-2">
        <FiCheckCircle /> Lab ready — preview
        {grounded && <span className="text-[10px] font-semibold uppercase tracking-wide bg-green-100 text-green-700 px-1.5 py-0.5 rounded">grounded in lectures</span>}
      </div>
      <div className="text-sm text-gray-800 font-bold">{cfg.meta?.title}</div>
      <p className="text-xs text-gray-600 mt-0.5 mb-3">{cfg.scenario?.brief}</p>

      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Models</div>
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {(cfg.layers || []).map((l, i) => (
          <React.Fragment key={l.id || i}>
            {i > 0 && <span className="text-gray-300 text-xs">→</span>}
            <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-[#F9D0C4]/40 text-[#b8452a]">{l.short || l.name}</span>
          </React.Fragment>
        ))}
      </div>

      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Predict</div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {(cfg.predictionVariables || []).map((v) => (
          <span key={v.id} className="text-xs px-2 py-0.5 rounded bg-white border border-gray-200 text-gray-600">{v.label}</span>
        ))}
        {(cfg.layers || []).filter((l) => l.extensionPredict).map((l) => (
          <span key={`ep-${l.id}`} className="text-xs px-2 py-0.5 rounded bg-white border border-gray-200 text-gray-500">{l.short}: {l.extensionPredict.focus}?</span>
        ))}
      </div>

      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Synthesis</div>
      <p className="text-xs text-gray-600">{cfg.synthesis?.task}</p>
    </div>
  );
}
