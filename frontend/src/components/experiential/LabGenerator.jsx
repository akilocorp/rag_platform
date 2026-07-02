import React, { useState, useEffect } from 'react';
import { FaSpinner } from 'react-icons/fa';
import { FiZap, FiCheckCircle, FiAlertTriangle } from 'react-icons/fi';
import apiClient from '../../api/apiClient';
import { validateExperientialConfig } from '../../configs/experiential/schema';
import { getMethod } from '../../methods/registry';

// Generate-on-save UI for experiential labs: the professor picks a pedagogical
// method, writes a design prompt that fine-tunes it, hits Generate, and Claude
// (grounded in the config's knowledge base when a configId is supplied) returns
// a full lab config. We validate it client side and show a preview before save.
// The method list comes from the backend registry (one file per pedagogy in
// backend/src/experiential/methods/), so adding a method needs no frontend edit.
const FALLBACK_METHODS = [
  { id: 'econ', label: 'Economics (baseline → complications)', description: '', prompt_hint: '' },
  { id: 'generic', label: 'Generic (any discipline)', description: '', prompt_hint: '' },
];

export default function LabGenerator({ prompt, onPromptChange, generated, onGenerated, configId, files }) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [grounded, setGrounded] = useState(false);
  const [methods, setMethods] = useState(FALLBACK_METHODS);
  const [template, setTemplate] = useState('econ');
  // Method-owned structured inputs (e.g. shock-world's countries / N / course-only).
  // Opaque here — the selected method's ConfigForm reads/writes this shape.
  const [methodParams, setMethodParams] = useState({});

  // Load the pedagogical methods the registry exposes. Falls back to the two
  // built-ins if the endpoint is unavailable so the generator still works.
  useEffect(() => {
    let alive = true;
    apiClient.get('/experiential/methods')
      .then(({ data }) => {
        const list = data?.methods;
        if (alive && Array.isArray(list) && list.length) {
          setMethods(list);
          setTemplate((t) => (list.some((m) => m.id === t) ? t : list[0].id));
        }
      })
      .catch(() => { /* keep fallback methods */ });
    return () => { alive = false; };
  }, []);

  const activeMethod = methods.find((m) => m.id === template) || methods[0];
  // The self-contained frontend method (validator + player + optional ConfigForm),
  // if this pedagogy ships one. Keyed by the backend method id, which for a
  // brand-new pedagogy equals its frontend schema id (e.g. 'shock-world').
  const frontendMethod = getMethod(template);
  const ConfigForm = frontendMethod?.ConfigForm || null;

  const handleGenerate = async () => {
    const p = (prompt || '').trim();
    if (!p) { setError('Write a design prompt first.'); return; }
    setGenerating(true);
    setError(null);
    try {
      // Generation is a single long Claude call (~30-60s). Give it room so a
      // slow-but-successful response isn't aborted by a default client timeout.
      // When the create wizard supplies not-yet-saved files, send them multipart
      // so the generator can ground the lab in them; otherwise send JSON (the
      // editor grounds via the saved knowledge base by config_id).
      let data;
      if (files && files.length) {
        const fd = new FormData();
        fd.append('prompt', p);
        fd.append('template', template);
        if (configId) fd.append('config_id', configId);
        fd.append('method_params', JSON.stringify(methodParams));
        files.forEach((f) => fd.append('files', f));
        ({ data } = await apiClient.post('/experiential/generate', fd, {
          timeout: 180000, headers: { 'Content-Type': 'multipart/form-data' },
        }));
      } else {
        ({ data } = await apiClient.post(
          '/experiential/generate',
          { prompt: p, template, config_id: configId || undefined, method_params: methodParams },
          { timeout: 180000 },
        ));
      }
      // Validate with the generated pedagogy's own validator when it ships one,
      // else the built-in predict-reveal validator.
      const validate = getMethod(data.config?.method)?.validate || validateExperientialConfig;
      const { ok, errors } = validate(data.config);
      if (!ok) {
        setError(`The generated lab didn't validate: ${errors.slice(0, 3).join('; ')}. Try Generate again or tweak your prompt.`);
        setGenerating(false);
        return;
      }
      setGrounded(!!data.grounded);
      onGenerated(data.config);
    } catch (e) {
      const timedOut = e.code === 'ECONNABORTED' || /timeout/i.test(e.message || '');
      setError(
        e.response?.data?.error
        || (timedOut
          ? 'The lab took too long to come back and the request timed out — it may have generated anyway. Wait a few seconds and try again.'
          : 'Generation failed.'),
      );
    }
    setGenerating(false);
  };

  return (
    <div>
      <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Pedagogical method</label>
      <select
        value={template}
        onChange={(e) => { setTemplate(e.target.value); setMethodParams({}); }}
        className="w-full mb-1.5 p-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all"
      >
        {methods.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>
      {activeMethod?.description && (
        <p className="text-[11px] text-gray-400 mb-3">{activeMethod.description}</p>
      )}

      {/* Method-owned structured inputs, rendered generically when the selected
          pedagogy ships a ConfigForm (e.g. shock-world's countries / N / course-only). */}
      {ConfigForm && (
        <div className="mb-3">
          <ConfigForm params={methodParams} onChange={setMethodParams} />
        </div>
      )}

      <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Lab design prompt</label>
      <textarea
        value={prompt || ''}
        onChange={(e) => onPromptChange(e.target.value)}
        rows={5}
        placeholder={activeMethod?.prompt_hint || 'Describe the lab: the baseline students know, the complications to add, the measures that move, and the lectures to ground it in.'}
        className="w-full p-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all resize-y"
      />
      <p className="text-[11px] text-gray-400 mt-1.5">
        Claude builds the full lab from your design prompt{(configId || (files && files.length)) ? ' grounded in your uploaded course materials' : ''}. You review it before saving.
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
      {generated && !generated.layers && (
        <GenericLabPreview cfg={generated} grounded={grounded} />
      )}
    </div>
  );
}

// Fallback confirmation for pedagogies that don't use the predict-reveal
// layers shape (e.g. shock-world). Keeps the generator method-agnostic.
function GenericLabPreview({ cfg, grounded }) {
  const chips = Array.isArray(cfg.countries) ? cfg.countries
    : (Array.isArray(cfg.targetIntuitions) ? cfg.targetIntuitions.map((t) => t.label || t.id) : []);
  return (
    <div className="mt-4 rounded-2xl border border-green-200 bg-green-50/40 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-green-700 mb-2">
        <FiCheckCircle /> Lab ready — preview
        {grounded && <span className="text-[10px] font-semibold uppercase tracking-wide bg-green-100 text-green-700 px-1.5 py-0.5 rounded">grounded in lectures</span>}
      </div>
      <div className="text-sm text-gray-800 font-bold">{cfg.meta?.title}</div>
      <p className="text-xs text-gray-600 mt-0.5 mb-3">{cfg.scenario?.brief}</p>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c, i) => (
            <span key={i} className="text-xs px-2 py-0.5 rounded bg-white border border-gray-200 text-gray-600">{c}</span>
          ))}
        </div>
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
