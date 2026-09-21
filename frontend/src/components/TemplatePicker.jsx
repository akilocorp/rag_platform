/**
 * @language  JavaScript (React / JSX)
 * @updated   2026-09-17
 * @changed   New file: the "Start from a template" tab inside the create dialog. Replaces
 *            NewClassModal, which was a second modal in front of the wizard rather than a
 *            tab inside it.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { FaSpinner, FaArrowLeft, FaUser, FaFile } from 'react-icons/fa';
import apiClient from '../api/apiClient';
import { botTypeInfo } from '../utils/botTypes';

/**
 * A panel, not a modal: it renders inside ConfigModal's "Start from a template" tab
 * and owns only the space below the tab bar. The dialog shell, the close button and
 * the tab switch all belong to ConfigModal.
 *
 * Two sub-views of its own: the template grid, then the name form for whichever
 * template was picked.
 *
 * Props:
 *   onCreated(config, filesCopied) — a template was instantiated server-side.
 *   onBuildFromScratch()           — the empty-state link, switches to the wizard tab.
 */
export default function TemplatePicker({ onCreated, onBuildFromScratch }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  // null = showing the grid; a card object = showing that template's name form.
  const [picked, setPicked] = useState(null);
  const [botName, setBotName] = useState('');
  const [classCode, setClassCode] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [busy, setBusy] = useState(false);

  // Fetched on mount, and the panel unmounts when the dialog closes — so a colleague
  // publishing a class mid-session shows up the next time the dialog is opened,
  // without a page reload.
  useEffect(() => {
    let alive = true;
    apiClient.get('/config/templates')
      .then(({ data }) => { if (alive) setTemplates(data.templates || []); })
      .catch(() => { if (alive) setLoadError('Could not load templates. You can still build from scratch.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const pick = useCallback((card) => {
    setPicked(card);
    setBotName(card.default_name || card.title);
    setSubmitError('');
  }, []);

  const submit = async () => {
    if (!botName.trim() || busy) return;
    setBusy(true);
    setSubmitError('');
    try {
      const { data } = await apiClient.post('/config/from-template', {
        template_id: picked.template_id,
        bot_name: botName.trim(),
        class_code: classCode.trim().toLowerCase(),
      });
      onCreated(data.config, data.files_copied);
    } catch (err) {
      setSubmitError(err.response?.data?.error || 'Could not create a class from this template.');
    } finally {
      setBusy(false);
    }
  };

  const builtins = templates.filter((t) => t.source === 'builtin');
  const published = templates.filter((t) => t.source === 'config');

  // One template tile. Built-ins carry their own emoji; a published class falls back
  // to its bot_type's icon so the grid still reads as one set.
  const Card = ({ card }) => {
    const info = botTypeInfo(card.bot_type);
    const Icon = info.icon;
    return (
      <button
        type="button"
        onClick={() => pick(card)}
        className="text-left p-5 bg-white border-2 border-gray-200 rounded-2xl hover:border-[#FA6C43] hover:-translate-y-0.5 hover:shadow-md transition-all active:scale-[0.98] flex flex-col h-full"
      >
        <div className="flex items-center gap-3 mb-2.5">
          {card.icon
            ? <span className="text-2xl leading-none">{card.icon}</span>
            : <Icon className="text-xl text-[#FA6C43]" />}
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{info.label}</span>
        </div>
        <h4 className="text-[15px] font-bold text-[#222] mb-1">{card.title}</h4>
        <p className="text-xs text-gray-500 font-medium leading-relaxed flex-1">
          {card.description || 'No description provided.'}
        </p>
        <div className="flex items-center gap-3 mt-3 text-[11px] font-semibold text-gray-400">
          {card.source === 'config' && (
            <span className="flex items-center gap-1.5">
              <FaUser className="text-[9px]" />
              {card.is_own ? 'You' : card.author}
            </span>
          )}
          {card.file_count > 0 && (
            <span className="flex items-center gap-1.5">
              <FaFile className="text-[9px]" />
              {card.file_count} file{card.file_count === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </button>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-16 justify-center text-gray-500">
        <FaSpinner className="animate-spin text-[#FA6C43]" /> Loading templates…
      </div>
    );
  }

  // Naming step. Instantiating a template makes a NEW class, so the class code is
  // typed fresh (it is globally unique and can never be inherited) and nothing from
  // the source's roster, transcripts or usage comes along.
  //
  // This is an early RETURN, not a `const nameForm = (<>…</>)` picked by a ternary
  // further down. JSX assigned to a const is evaluated eagerly, so a `picked.title`
  // inside one runs on every render — including the first, where `picked` is null —
  // and takes the whole React tree down with it the moment the dialog opens. That
  // was a real crash here; keep the guard structural.
  if (picked) {
    return (
      <div className="animate-in fade-in slide-in-from-right-4">
        <button
          type="button"
          onClick={() => setPicked(null)}
          className="flex items-center gap-2 text-xs font-bold text-gray-400 hover:text-[#FA6C43] mb-5 transition-colors"
        >
          <FaArrowLeft className="text-[10px]" /> All templates
        </button>

        <h2 className="text-2xl font-bold text-[#222] mb-1.5">{picked.title}</h2>
        <p className="text-sm text-gray-500 mb-6">
          {picked.file_count > 0
            ? `Creates your own copy — its ${picked.file_count} knowledge-base file${picked.file_count === 1 ? '' : 's'} come along, but no student data does.`
            : 'Creates your own copy. You can change everything about it afterwards.'}
        </p>

        <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Class name</label>
        <input
          autoFocus
          value={botName}
          onChange={(e) => setBotName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm outline-none focus:border-[#FA6C43]"
        />

        <label className="block text-[13px] font-semibold text-gray-700 mt-4 mb-1.5">
          Class code <span className="font-normal text-gray-400">(optional)</span>
        </label>
        <input
          value={classCode.toUpperCase()}
          onChange={(e) => setClassCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          maxLength={20}
          placeholder="e.g. ACTR101"
          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm outline-none focus:border-[#FA6C43] uppercase"
        />
        <p className="text-[11px] text-gray-400 mt-1">
          3–20 characters, letters, numbers, hyphens. Must be unique — students join with it.
        </p>

        {submitError && <p className="mt-3 text-xs font-semibold text-red-600">{submitError}</p>}

        <button
          type="button"
          onClick={submit}
          disabled={!botName.trim() || busy}
          className="w-full mt-7 py-3 px-6 rounded-xl font-bold text-white bg-[#FA6C43] hover:bg-[#E55B34] disabled:opacity-50 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
        >
          {busy && <FaSpinner className="animate-spin text-sm" />}
          {busy ? 'Creating…' : 'Create class'}
        </button>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-left-4">
      <h2 className="text-2xl font-bold text-center text-[#222] mb-2">Start from a template</h2>
      <p className="text-sm text-gray-500 text-center mb-7">
        Pick a ready-made class and adjust it afterwards.
      </p>

      {loadError && <p className="text-sm font-semibold text-red-600 mb-5">{loadError}</p>}

      {builtins.length > 0 && (
        <section className="mb-7">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-3">Ready-made classes</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {builtins.map((c) => <Card key={c.template_id} card={c} />)}
          </div>
        </section>
      )}

      {published.length > 0 && (
        <section>
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-3">Published by professors</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {published.map((c) => <Card key={c.template_id} card={c} />)}
          </div>
        </section>
      )}

      {!loadError && builtins.length === 0 && published.length === 0 && (
        <div className="text-center py-10">
          <p className="text-sm text-gray-500 font-medium mb-4">No templates available yet.</p>
          <button
            type="button"
            onClick={onBuildFromScratch}
            className="text-sm font-bold text-[#FA6C43] hover:underline"
          >
            Build from scratch instead
          </button>
        </div>
      )}

      {published.length === 0 && builtins.length > 0 && (
        <p className="text-xs text-gray-400 font-medium text-center pt-5">
          Classes other professors publish as templates appear here. You can publish your own
          from its settings.
        </p>
      )}
    </div>
  );
}
