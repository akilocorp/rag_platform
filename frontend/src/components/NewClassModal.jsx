/**
 * @language  JavaScript (React / JSX)
 * @updated   2026-09-17
 * @changed   New file: the "New Assistant" gallery — start from a ready-made class
 *            (ACTR built-ins or a class another professor published) or from scratch.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { FaTimes, FaSpinner, FaPlus, FaArrowLeft, FaUser, FaFile } from 'react-icons/fa';
import apiClient from '../api/apiClient';
import { botTypeInfo } from '../utils/botTypes';

/**
 * The first screen of class creation.
 *
 * Clicking "New Assistant" used to drop the professor straight into a five-step
 * wizard whose first decision (which of six class types?) is the one they are
 * least equipped to make. This puts the ready-made classes first and keeps the
 * blank wizard as an explicit choice.
 *
 * Props:
 *   onStartBlank()                  — professor chose "Start from scratch"; the
 *                                     caller opens the existing wizard modal.
 *   onCreated(config, filesCopied)  — a template was instantiated server-side.
 */
export default function NewClassModal({ isOpen, onClose, onStartBlank, onCreated }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  // null = showing the grid; a card object = showing that template's name form.
  const [picked, setPicked] = useState(null);
  const [botName, setBotName] = useState('');
  const [classCode, setClassCode] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [busy, setBusy] = useState(false);

  // Templates are fetched per open rather than once: a colleague publishing a
  // class mid-session should show up without a page reload.
  useEffect(() => {
    if (!isOpen) return;
    setPicked(null);
    setSubmitError('');
    setClassCode('');
    setBusy(false);
    setLoading(true);
    setLoadError('');
    let alive = true;
    apiClient.get('/config/templates')
      .then(({ data }) => { if (alive) setTemplates(data.templates || []); })
      .catch(() => { if (alive) setLoadError('Could not load templates. You can still start from scratch.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [isOpen]);

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

  if (!isOpen) return null;

  const builtins = templates.filter((t) => t.source === 'builtin');
  const published = templates.filter((t) => t.source === 'config');

  // One template tile. Built-ins carry their own emoji; a published class falls
  // back to its bot_type's icon so the grid still reads as a set.
  const Card = ({ card }) => {
    const info = botTypeInfo(card.bot_type);
    const Icon = info.icon;
    return (
      <button
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

  const gallery = (
    <>
      <div className="mb-6">
        <h2 className="text-xl font-extrabold text-[#222] mb-1">Create a class</h2>
        <p className="text-sm text-gray-500 font-medium">
          Start from a ready-made class and adjust it, or build one from scratch.
        </p>
      </div>

      {/* The blank wizard, kept as a first-class option rather than a footer link —
          a professor who knows exactly what they want shouldn't have to scroll. */}
      <button
        onClick={onStartBlank}
        className="w-full text-left p-5 mb-7 bg-[#FFF5F2] border-2 border-dashed border-[#FA6C43]/40 rounded-2xl hover:border-[#FA6C43] hover:bg-[#FFEDE7] transition-all active:scale-[0.99] flex items-center gap-4"
      >
        <div className="w-11 h-11 rounded-xl bg-[#FA6C43] text-white flex items-center justify-center shrink-0">
          <FaPlus />
        </div>
        <div>
          <h4 className="text-[15px] font-bold text-[#222]">Start from scratch</h4>
          <p className="text-xs text-gray-500 font-medium">Pick a class type and configure everything yourself.</p>
        </div>
      </button>

      {loading ? (
        <div className="flex items-center gap-3 py-10 justify-center text-gray-500">
          <FaSpinner className="animate-spin text-[#FA6C43]" /> Loading templates…
        </div>
      ) : loadError ? (
        <p className="text-sm font-semibold text-red-600 py-4">{loadError}</p>
      ) : (
        <>
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

          {published.length === 0 && (
            <p className="text-xs text-gray-400 font-medium text-center pt-2">
              Classes other professors publish as templates will appear here. You can publish your
              own from its settings.
            </p>
          )}
        </>
      )}
    </>
  );

  // Naming step. A template instantiation is a NEW class, so the class code is
  // typed fresh (it is globally unique and can never be inherited) and nothing
  // from the source's roster, transcripts or usage comes along.
  const nameForm = (
    <>
      <button
        onClick={() => setPicked(null)}
        className="flex items-center gap-2 text-xs font-bold text-gray-400 hover:text-[#FA6C43] mb-5 transition-colors"
      >
        <FaArrowLeft className="text-[10px]" /> All templates
      </button>

      <h2 className="text-xl font-extrabold text-[#222] mb-1">{picked.title}</h2>
      <p className="text-sm text-gray-500 mb-5">
        {picked.file_count > 0
          ? `Creates your own copy — its ${picked.file_count} knowledge-base file${picked.file_count === 1 ? '' : 's'} come along, but no student data does.`
          : 'Creates your own copy. You can change everything about it afterwards.'}
      </p>

      <label className="block text-sm font-bold text-gray-700 mb-1.5">Class name</label>
      <input
        autoFocus
        value={botName}
        onChange={(e) => setBotName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#FA6C43]/30 focus:border-[#FA6C43] outline-none"
      />

      <label className="block text-sm font-bold text-gray-700 mt-4 mb-1.5">
        Class code <span className="font-medium text-gray-400">(optional)</span>
      </label>
      <input
        value={classCode.toUpperCase()}
        onChange={(e) => setClassCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        maxLength={20}
        placeholder="e.g. ACTR101"
        className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#FA6C43]/30 focus:border-[#FA6C43] outline-none uppercase"
      />
      <p className="mt-1.5 text-xs text-gray-400 font-medium">
        3–20 characters, letters, numbers, hyphens. Must be unique — students join with it.
      </p>

      {submitError && <p className="mt-3 text-xs font-semibold text-red-600">{submitError}</p>}

      <div className="flex gap-3 mt-6">
        <button
          onClick={onClose}
          className="flex-1 py-3 px-6 rounded-xl font-bold border-2 border-gray-200 text-gray-700 bg-white hover:bg-gray-50 transition-all"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!botName.trim() || busy}
          className="flex-1 py-3 px-6 rounded-xl font-bold text-white bg-[#FA6C43] hover:bg-[#E55B34] disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
        >
          {busy && <FaSpinner className="animate-spin text-sm" />}
          {busy ? 'Creating…' : 'Create class'}
        </button>
      </div>
    </>
  );

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div
        className="bg-white rounded-[1.75rem] shadow-2xl w-full max-w-3xl max-h-[88vh] overflow-y-auto relative animate-in zoom-in-95 duration-200 p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} title="Close" className="absolute top-5 right-5 p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-all z-10">
          <FaTimes />
        </button>
        {picked ? nameForm : gallery}
      </div>
    </div>
  );
}
