// @language  JavaScript (React / JSX)
// @updated   2026-08-16
// @changed   Categories sidebar gained Labs (experiential) and Exercises (manager_exercise), carved out of
//            Text-based so each assistant sits in exactly one category.
//            Prior: Header gained a "Plan from syllabus" button into /course-plan.
//            Prior: card body click now selects the card (Ctrl+C copy target) instead of opening
//            the bot; the bot opens only via the primary button (Chat Now / Open Dashboard / etc.).
import { FaCog, FaPlus, FaRobot, FaSpinner, FaBug, FaListAlt, FaTrash, FaThLarge, FaList, FaExternalLinkAlt, FaShareAlt, FaCopy, FaCheck, FaTimes, FaClone, FaPaste } from 'react-icons/fa';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import UserInfo from '../components/UserInfo';
import ConfigModeToggle from '../components/ConfigModeToggle';
import { getBotAvatarIconComponent } from '../components/AvatarSelector';
import { getModelDisplayName } from '../utils/modelNames';
import { studentPathFor } from '../utils/botTypes';
import apiClient from '../api/apiClient';
// Import your modal components here (adjust paths as needed)
import ConfigModal from './ConfigPage';
import ReportBugModal from './ReportBugModal';

// Primary action label + the route a card opens, derived from bot_type.
// Keeps the existing routing behavior (chat / group / dashboards / sessions).
const primaryActionLabel = (botType) => {
  switch (botType) {
    case 'video_analysis': return 'Open Dashboard';
    case 'experiential':   return 'Open Sessions';
    case 'group_chat':     return 'Open Chat';
    case 'manager_exercise': return 'Open Exercise';
    default:               return 'Chat Now';
  }
};

// The direct student-facing URL for a config, by bot_type (fallback when no
// class code is set). The bot_type → path map lives in utils/botTypes so the
// student dashboard and the join page route to the same places.
const directStudentLink = (config) =>
  `${window.location.origin}${studentPathFor(config.bot_type, config.config_id)}`;

// --- Clipboard transfer -------------------------------------------------------
// Ctrl+C puts one readable line on the clipboard. The payload is a server-minted
// token, not the config itself: the knowledge base only exists server-side, so
// the clone has to happen there — and a token is what lets a copy cross into
// another professor's account.
const CLIPBOARD_PREFIX = 'actr-config:';
const CLIPBOARD_TOKEN_RE = /actr-config:([A-Za-z0-9_-]{8,})/;

const clipboardPayload = (botName, token) =>
  `ACTR assistant "${botName}" — paste it in your assistant list (Ctrl+V): ${CLIPBOARD_PREFIX}${token}`;

const parseConfigToken = (text) => (text || '').match(CLIPBOARD_TOKEN_RE)?.[1] || null;

// Write to the clipboard, falling back to the legacy execCommand path — the
// async Clipboard API is unavailable outside secure contexts, which is exactly
// where a professor testing on a plain-http host would be.
const writeClipboard = async (text) => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to execCommand */ }
  try {
    const scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.style.position = 'fixed';
    scratch.style.opacity = '0';
    document.body.appendChild(scratch);
    scratch.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(scratch);
    return ok;
  } catch {
    return false;
  }
};

// True when the keystroke belongs to a text field or a live text selection —
// Ctrl+C must keep meaning "copy this text" in those cases, not "copy the card".
const isTypingContext = () => {
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return true;
  const selection = window.getSelection?.();
  return !!(selection && !selection.isCollapsed && String(selection).trim());
};

// Right-click menu. Rendered at the pointer, dismissed by any outside click,
// scroll or Escape.
const ContextMenu = ({ menu, onClose, items }) => {
  useEffect(() => {
    if (!menu) return undefined;
    const dismiss = () => onClose();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('click', dismiss);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', dismiss);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  // Keep the panel inside the viewport when the click lands near an edge.
  const left = Math.min(menu.x, window.innerWidth - 210);
  const top = Math.min(menu.y, window.innerHeight - (items.length * 40 + 16));

  return (
    <div
      className="fixed z-[120] w-[200px] py-1.5 bg-white rounded-xl border border-gray-200 shadow-xl animate-in zoom-in-95 duration-100"
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={() => { onClose(); item.onClick(); }}
          disabled={item.disabled}
          className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm font-semibold text-gray-700 hover:bg-[#FFF5F2] hover:text-[#FA6C43] disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-700 transition-colors text-left"
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
};

// The paste dialog: names the copy and takes its class code. Both are asked for
// because a paste creates a NEW class — the class code is globally unique, so it
// can never be inherited, and the copy starts with no students and no
// transcripts of its own.
const PasteConfigModal = ({ isOpen, token, preview, loadError, onResolveToken, onClose, onCreated }) => {
  const [botName, setBotName] = useState('');
  const [classCode, setClassCode] = useState('');
  const [manualText, setManualText] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setSubmitError('');
    setBusy(false);
    setClassCode('');
    setManualText('');
  }, [isOpen, token]);

  // Prefill the name the moment the preview lands, so the professor only edits.
  useEffect(() => {
    if (preview?.bot_name) setBotName(`${preview.bot_name} (copy)`);
  }, [preview]);

  if (!isOpen) return null;

  const submit = async () => {
    if (!botName.trim() || busy) return;
    setBusy(true);
    setSubmitError('');
    try {
      const { data } = await apiClient.post(`/config/paste/${token}`, {
        bot_name: botName.trim(),
        class_code: classCode.trim().toLowerCase(),
      });
      onCreated(data.config, data.files_copied);
    } catch (err) {
      setSubmitError(err.response?.data?.error || 'Could not paste this assistant.');
    } finally {
      setBusy(false);
    }
  };

  // No token in hand: the browser refused a clipboard read, so let the professor
  // paste the copied line straight into the dialog.
  const manualEntry = (
    <>
      <p className="text-sm text-gray-500 mb-4">
        Paste the copied text below (Ctrl+V), then continue.
      </p>
      <textarea
        autoFocus
        rows={3}
        value={manualText}
        onChange={(e) => setManualText(e.target.value)}
        placeholder="ACTR assistant … actr-config:…"
        className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#FA6C43]/30 focus:border-[#FA6C43] outline-none resize-none"
      />
      {manualText && !parseConfigToken(manualText) && (
        <p className="mt-2 text-xs font-semibold text-red-600">
          That doesn’t look like a copied assistant. Copy one with Ctrl+C first.
        </p>
      )}
      <button
        onClick={() => onResolveToken(parseConfigToken(manualText))}
        disabled={!parseConfigToken(manualText)}
        className="w-full mt-5 py-3 px-6 rounded-xl font-bold text-white bg-[#FA6C43] hover:bg-[#E55B34] disabled:opacity-50 transition-all"
      >
        Continue
      </button>
    </>
  );

  const form = (
    <>
      <p className="text-sm text-gray-500 mb-5">
        This creates a brand-new assistant in your account — {preview?.file_count > 0
          ? `its ${preview.file_count} knowledge-base file${preview.file_count === 1 ? '' : 's'} come along, but no `
          : 'with no '}
        student chats, responses or usage carry over.
      </p>

      <label className="block text-sm font-bold text-gray-700 mb-1.5">Name</label>
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
        3–20 characters, letters, numbers, hyphens. Must be unique — the original’s code stays with the original class.
      </p>

      {submitError && (
        <p className="mt-3 text-xs font-semibold text-red-600">{submitError}</p>
      )}

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
          {busy ? 'Copying…' : 'Create copy'}
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
        className="bg-white rounded-[1.75rem] shadow-2xl w-full max-w-lg overflow-hidden relative animate-in zoom-in-95 duration-200 p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} title="Close" className="absolute top-5 right-5 p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-all">
          <FaTimes />
        </button>

        <div className="w-12 h-12 rounded-full bg-[#FFF5F2] flex items-center justify-center mb-4">
          <FaPaste className="text-[#FA6C43]" />
        </div>
        <h2 className="text-xl font-extrabold text-[#222] mb-1">
          {preview ? `Paste “${preview.bot_name}”` : 'Paste an assistant'}
        </h2>
        {preview && (
          <p className="text-xs font-semibold text-gray-400 mb-4 uppercase tracking-wide">
            {getModelDisplayName(preview.model_name)}
            {preview.file_count > 0 && ` · ${preview.file_count} file${preview.file_count === 1 ? '' : 's'}`}
          </p>
        )}

        {loadError ? (
          <p className="text-sm font-semibold text-red-600 py-4">{loadError}</p>
        ) : !token ? (
          manualEntry
        ) : !preview ? (
          <div className="flex items-center gap-3 py-8 text-gray-500">
            <FaSpinner className="animate-spin text-[#FA6C43]" /> Looking up the copied assistant…
          </div>
        ) : (
          form
        )}
      </div>
    </div>
  );
};

// "Share to class" popup: shows the class-invite link (/join/<code>) when the
// bot has a class code, else the direct link. Copy + Cancel.
const ShareModal = ({ isOpen, onClose, config }) => {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (isOpen) setCopied(false); }, [isOpen]);
  if (!isOpen) return null;

  const classLink = config.class_code ? `${window.location.origin}/join/${config.class_code}` : '';
  const link = classLink || directStudentLink(config);

  const copy = () => {
    navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={(e) => { e.stopPropagation(); onClose(); }}
      // Let the browser's own menu handle right-clicks on the link, instead of
      // the card's copy/paste menu firing through the overlay.
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div
        className="bg-white rounded-[1.75rem] shadow-2xl w-full max-w-lg overflow-hidden relative animate-in zoom-in-95 duration-200 p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} title="Close" className="absolute top-5 right-5 p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-all">
          <FaTimes />
        </button>

        <div className="w-12 h-12 rounded-full bg-[#FFF5F2] flex items-center justify-center mb-4">
          <FaShareAlt className="text-[#FA6C43]" />
        </div>
        <h2 className="text-xl font-extrabold text-[#222] mb-1">Share to class</h2>
        <p className="text-sm text-gray-500 mb-5">
          {classLink
            ? 'Share this link with your students — they’ll join your class and land straight in the bot.'
            : 'This bot has no class code yet. You can share the direct link below, or add a class code under Customize for a class-invite link.'}
        </p>

        <div className="flex items-center gap-2 mb-6">
          <code className="flex-1 text-sm text-gray-700 truncate bg-[#FFF5F2] border border-[#FA6C43]/20 px-3 py-2.5 rounded-xl">{link}</code>
          <button
            onClick={copy}
            className="px-4 py-2.5 rounded-xl bg-[#FA6C43] text-white text-sm font-semibold flex items-center gap-2 shrink-0 hover:bg-[#E55B34] transition-colors"
          >
            {copied ? <FaCheck /> : <FaCopy />} {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>

        <button
          onClick={onClose}
          className="w-full py-3 px-6 rounded-xl font-bold border-2 border-gray-200 text-gray-700 bg-white hover:bg-gray-50 hover:border-gray-300 transition-all"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

const ConfigItem = ({ config, index, view, onOpen, onSelect, onResponses, onEdit, onDelete, onCopy, onHover, onCardMenu, isSelected }) => {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const ListIcon = getBotAvatarIconComponent(config.bot_avatar);
  const isList = view === 'list';

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDelete(config.config_id);
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  };

  // Icon actions (Responses + Delete). In grid view these sit top-right next
  // to the title; in list view they're relocated into the footer cluster so
  // they line up with Customize / Chat Now on one vertically-centered row.
  const actionButtons = (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); onCopy(config); }}
        title="Copy assistant (Ctrl+C)"
        className="p-1.5 text-gray-400 rounded-lg hover:text-[#FA6C43] hover:bg-[#F9D0C4]/30 transition-colors"
      >
        <FaClone className="text-sm" />
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); setShareOpen(true); }}
        title="Share to class"
        className="p-1.5 text-gray-400 rounded-lg hover:text-[#FA6C43] hover:bg-[#F9D0C4]/30 transition-colors"
      >
        <FaShareAlt className="text-sm" />
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onResponses(config); }}
        title={config.bot_type === 'video_analysis' ? 'Dashboard' : config.bot_type === 'experiential' ? 'Sessions' : 'Responses'}
        className="p-1.5 text-gray-400 rounded-lg hover:text-[#FA6C43] hover:bg-[#F9D0C4]/30 transition-colors"
      >
        <FaListAlt className="text-sm" />
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); setConfirming(true); }}
        title="Delete"
        className="p-1.5 text-gray-400 rounded-lg hover:text-red-600 hover:bg-red-50 transition-colors"
      >
        <FaTrash className="text-sm" />
      </button>
    </>
  );

  return (
    <div
      className={`group relative bg-white rounded-2xl border shadow-sm transition-all duration-300 cursor-pointer hover:border-[#FA6C43]/40 hover:shadow-md hover:-translate-y-1 animate-send-fly-in ${
        isSelected ? 'border-[#FA6C43] ring-2 ring-[#FA6C43]/30' : 'border-gray-200'
      } ${isList ? 'p-5 flex items-center gap-5' : 'p-5 flex flex-col'}`}
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
      // Clicking the card body selects it as the Ctrl+C copy target (the orange
      // ring). Opening the bot is the primary button's job (Chat Now, etc.).
      onClick={() => onSelect(config)}
      // Hover is a fallback Ctrl+C target when nothing is selected; right-click
      // both selects the card and opens its menu.
      onMouseEnter={() => onHover(config)}
      onMouseLeave={() => onHover(null)}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onCardMenu(e, config); }}
    >
      {/* Top: icon + title + actions */}
      <div className={isList ? 'flex items-center gap-4 flex-1 min-w-0' : 'flex items-start gap-4'}>
        <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center text-[#1F1F1F]">
          {ListIcon ? <ListIcon className="text-xl" /> : <FaRobot className="text-xl" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <h3 className="text-[15px] font-bold text-[#222] truncate flex-1">{config.bot_name}</h3>
            {!isList && (
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {actionButtons}
              </div>
            )}
          </div>

          <p className="text-sm text-gray-500 mt-1.5 line-clamp-2">
            {config.introduction?.trim() || `${getModelDisplayName(config.model_name)} assistant.`}
          </p>

          {/* Info chips */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-[#F0F6FB] text-gray-600 border border-gray-100 animate-chip-in">
              {getModelDisplayName(config.model_name)}
            </span>
            {config.class_code && (
              <span className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-[#F9D0C4]/30 text-[#FA6C43] border border-[#FA6C43]/20 uppercase tracking-wide animate-chip-in">
                {config.class_code}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Footer: customize + primary action, or delete confirmation */}
      <div className={`relative z-10 ${isList ? 'flex-shrink-0' : 'mt-4 pt-4 border-t border-gray-100'}`}>
        {confirming ? (
          <div className={`flex items-center gap-2 ${isList ? '' : 'justify-end'}`} onClick={(e) => e.stopPropagation()}>
            <span className="text-xs font-medium text-gray-500 mr-auto">Delete this assistant?</span>
            <button
              onClick={() => setConfirming(false)}
              className="px-3 py-1.5 text-xs font-bold text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="px-3 py-1.5 text-xs font-bold text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors flex items-center gap-1.5 disabled:opacity-60"
            >
              {deleting && <FaSpinner className="animate-spin text-[10px]" />}
              Delete
            </button>
          </div>
        ) : (
          <div className={`flex items-center gap-3 ${isList ? '' : 'justify-between'}`}>
            {isList && (
              <div className="flex items-center gap-1.5 mr-1">
                {actionButtons}
              </div>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(config); }}
              className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-[#FA6C43] transition-colors"
            >
              <FaCog className="text-sm" />
              Customize
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onOpen(config); }}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-[#FA6C43] hover:text-white hover:border-[#FA6C43] transition-colors active:scale-[0.98]"
            >
              <FaExternalLinkAlt className="text-[10px]" />
              {primaryActionLabel(config.bot_type)}
            </button>
          </div>
        )}
      </div>

      <ShareModal isOpen={shareOpen} onClose={() => setShareOpen(false)} config={config} />
    </div>
  );
};

const ConfigListPage = () => {
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Dashboard view state
  const [visibility, setVisibility] = useState('private'); // 'private' | 'shared'
  const [category, setCategory] = useState('all');          // 'all' | 'text' | 'video'
  const [view, setView] = useState('grid');                 // 'grid' | 'list'

  // State to manage modal visibilities
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [isBugModalOpen, setIsBugModalOpen] = useState(false);

  // Copy/paste state. `hoveredRef` is a ref, not state, because the Ctrl+C
  // handler only reads it — tracking hover in state would re-render the whole
  // list on every pointer move across a card.
  const hoveredRef = useRef(null);
  const [selectedId, setSelectedId] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);   // {x, y, config|null}
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteToken, setPasteToken] = useState(null);
  const [pastePreview, setPastePreview] = useState(null);
  const [pasteLoadError, setPasteLoadError] = useState('');
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);

  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const loadPageData = async () => {
      setLoading(true);
      try {
        const response = await apiClient.get('/config_list');
        setConfigs(response.data.configs);
      } catch (err) {
        console.error('Failed to load configurations:', err);
        setError('Failed to load configurations');
        if (err.response?.status === 401) {
          navigate('/login');
        }
      } finally {
        setLoading(false);
      }
    };

    loadPageData();
  }, [location.key, navigate]);

  // Open a config = the existing select/routing behavior, used by the card body
  // and the primary action button.
  const handleOpen = (config) => {
    if (!config.config_id) {
      console.error('Invalid config:', config);
      setError('Failed to select configuration');
      return;
    }
    if (config.bot_type === 'video_analysis') {
      navigate(`/video-dashboard/${config.config_id}`);
    } else if (config.bot_type === 'experiential') {
      navigate(`/experiential-dashboard/${config.config_id}`);
    } else if (config.bot_type === 'group_chat') {
      navigate(`/group-chat/${config.config_id}`);
    } else if (config.bot_type === 'manager_exercise') {
      // Manager Exercise is a student-facing game like group chat (no faculty
      // dashboard) — route to its own page, not the 1:1 chat fallback.
      navigate(`/manager-exercise/${config.config_id}`);
    } else {
      navigate(`/chat/${config.config_id}`);
    }
  };

  const handleResponses = (config) => {
    navigate(
      config.bot_type === 'video_analysis' ? `/video-dashboard/${config.config_id}`
        : config.bot_type === 'experiential' ? `/experiential-dashboard/${config.config_id}`
        : `/responses/${config.config_id}`,
    );
  };

  const onEdit = (config) => {
    const configForEdit = {
      ...config,
      config_id: config.config_id,
      _id: config.config_id,
      documents: config.documents || [],
    };
    navigate(`/edit-config`, { state: { config: configForEdit } });
  };

  const handleDelete = async (configId) => {
    try {
      await apiClient.delete(`/config/${configId}`);
      setConfigs(prev => prev.filter(c => (c.config_id || c._id) !== configId));
    } catch (err) {
      console.error('Failed to delete configuration:', err);
      setError('Failed to delete assistant');
    }
  };

  const handleCreateNew = () => {
    setIsConfigModalOpen(true);
  };

  // --- Copy / paste ----------------------------------------------------------

  const showToast = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4000);
  }, []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // Ctrl+C: mint a transfer token for the card and put one readable line on the
  // clipboard. The token is minted server-side even if the clipboard write is
  // refused, so the payload is surfaced in a toast rather than lost.
  const handleCopy = useCallback(async (config) => {
    const configId = config.config_id || config._id;
    if (!configId) return;
    try {
      const { data } = await apiClient.post(`/config/${configId}/copy`);
      const payload = clipboardPayload(data.bot_name, data.token);
      const ok = await writeClipboard(payload);
      showToast(ok
        ? `Copied “${data.bot_name}” — press Ctrl+V in any assistant list to paste it.`
        : `Copy this and paste it in an assistant list: ${payload}`);
    } catch (err) {
      console.error('Failed to copy configuration:', err);
      showToast('Could not copy this assistant.');
    }
  }, [showToast]);

  // Open the paste dialog for a token. Passing null opens it in manual-entry
  // mode, which is the fallback when the browser blocks reading the clipboard.
  const openPasteDialog = useCallback(async (token) => {
    setPasteOpen(true);
    setPasteToken(token || null);
    setPastePreview(null);
    setPasteLoadError('');
    if (!token) return;
    try {
      const { data } = await apiClient.get(`/config/paste/${token}`);
      setPastePreview(data);
    } catch (err) {
      setPasteLoadError(err.response?.data?.message || 'This copy has expired or is no longer valid.');
    }
  }, []);

  // Right-click → Paste. Reading the clipboard needs a permission most browsers
  // only grant in secure contexts; on refusal we fall back to asking for the text.
  const handleMenuPaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      const token = parseConfigToken(text);
      if (!token) {
        showToast('Nothing copied yet — press Ctrl+C on an assistant first.');
        return;
      }
      openPasteDialog(token);
    } catch {
      openPasteDialog(null);
    }
  }, [openPasteDialog, showToast]);

  // A pasted copy is a new assistant in this account — prepend it so it is
  // visible without a refetch, and clear any filter that would hide it.
  const handlePasted = useCallback((config, filesCopied) => {
    setPasteOpen(false);
    setConfigs(prev => [config, ...prev]);
    setVisibility(config.is_public ? 'shared' : 'private');
    setCategory('all');
    showToast(filesCopied > 0
      ? `“${config.bot_name}” created with ${filesCopied} file${filesCopied === 1 ? '' : 's'}. No student data was copied.`
      : `“${config.bot_name}” created. No student data was copied.`);
  }, [showToast]);

  // Keyboard copy. The target is the right-clicked card, else the hovered one.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!(e.ctrlKey || e.metaKey) || (e.key || '').toLowerCase() !== 'c') return;
      if (pasteOpen || isConfigModalOpen || isBugModalOpen || isTypingContext()) return;
      const target = configs.find(c => (c.config_id || c._id) === selectedId) || hoveredRef.current;
      if (!target) return;
      e.preventDefault();
      handleCopy(target);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [configs, selectedId, pasteOpen, isConfigModalOpen, isBugModalOpen, handleCopy]);

  // Ctrl+V anywhere on the list. The paste event hands us the clipboard text
  // directly, so this needs no permission prompt. Clipboard content that isn't
  // a copied assistant is ignored.
  useEffect(() => {
    const onPaste = (e) => {
      if (pasteOpen || isConfigModalOpen || isBugModalOpen) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const token = parseConfigToken(e.clipboardData?.getData('text'));
      if (!token) return;
      e.preventDefault();
      openPasteDialog(token);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [pasteOpen, isConfigModalOpen, isBugModalOpen, openPasteDialog]);

  const handleCardMenu = (e, config) => {
    setSelectedId(config.config_id || config._id);
    setContextMenu({ x: e.clientX, y: e.clientY, config });
  };

  const handleBackgroundMenu = (e) => {
    e.preventDefault();
    setSelectedId(null);
    setContextMenu({ x: e.clientX, y: e.clientY, config: null });
  };

  const contextMenuItems = contextMenu?.config
    ? [
        { label: 'Copy', icon: <FaClone className="text-xs" />, onClick: () => handleCopy(contextMenu.config) },
        { label: 'Customize', icon: <FaCog className="text-xs" />, onClick: () => onEdit(contextMenu.config) },
        { label: 'Paste', icon: <FaPaste className="text-xs" />, onClick: handleMenuPaste },
      ]
    : [
        { label: 'Paste', icon: <FaPaste className="text-xs" />, onClick: handleMenuPaste },
      ];

  // Apply the Private/Shared filter once; categories slice the result.
  const byVisibility = useMemo(
    () => configs.filter(c => (visibility === 'shared' ? !!c.is_public : !c.is_public)),
    [configs, visibility],
  );

  // Each assistant lands in exactly one category. Labs (experiential) and Exercises
  // (manager_exercise) are carved OUT of Text-based, which is otherwise every non-video
  // conversational bot (plain 1:1 + group-chat Drop-In Spaces).
  const isVideo = (c) => c.bot_type === 'video_analysis';
  const isLab = (c) => c.bot_type === 'experiential';
  const isExercise = (c) => c.bot_type === 'manager_exercise';
  const isText = (c) => !isVideo(c) && !isLab(c) && !isExercise(c);
  const counts = {
    all: byVisibility.length,
    text: byVisibility.filter(isText).length,
    lab: byVisibility.filter(isLab).length,
    exercise: byVisibility.filter(isExercise).length,
    video: byVisibility.filter(isVideo).length,
  };

  const visible = useMemo(() => byVisibility.filter(c => {
    if (category === 'text') return isText(c);
    if (category === 'lab') return isLab(c);
    if (category === 'exercise') return isExercise(c);
    if (category === 'video') return isVideo(c);
    return true;
  }), [byVisibility, category]);

  const sections = [
    { key: 'text', label: 'Text-based', items: visible.filter(isText) },
    { key: 'lab', label: 'Labs', items: visible.filter(isLab) },
    { key: 'exercise', label: 'Exercises', items: visible.filter(isExercise) },
    { key: 'video', label: 'Video-based', items: visible.filter(isVideo) },
  ].filter(s => s.items.length > 0);

  const CATEGORIES = [
    { key: 'all', label: 'All Assistants' },
    { key: 'text', label: 'Text-based' },
    { key: 'lab', label: 'Labs' },
    { key: 'exercise', label: 'Exercises' },
    { key: 'video', label: 'Video-based' },
  ];

  return (
    <div
      style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      className="min-h-screen bg-[#F0F6FB] text-gray-900 flex flex-col relative"
      onContextMenu={handleBackgroundMenu}
    >

      {/* Navbar */}
      <nav className="w-full flex justify-between items-center px-6 lg:px-8 py-6 max-w-[1440px] mx-auto z-10">
        <div
          className="flex items-center hover:opacity-90 transition-opacity cursor-pointer"
          onClick={() => navigate('/config_list')}
        >
          <img
            src="/actrlabs-wordmark.png"
            alt="ACTRLabs"
            className="h-10 lg:h-12 w-auto object-contain"
          />
        </div>
        <div className="flex items-center space-x-6 lg:space-x-8">

          {/* Faculty Simple/Advanced mode switch — gates how much bot-config
              detail the create/edit forms expose. */}
          <ConfigModeToggle className="hidden sm:block" />

          {/* Report Bug Button added to Navbar */}
          <button
            onClick={() => setIsBugModalOpen(true)}
            className="hidden sm:flex items-center justify-center px-5 py-2.5 bg-[#FA6C43] hover:bg-[#E55B34] text-white rounded-xl transition-all duration-200 shadow-sm active:scale-[0.98]"
          >
            <FaBug className="mr-2 text-sm" />
            <span className="font-bold text-[14px]">Report a Bug</span>
          </button>

          <UserInfo />
        </div>
      </nav>

      {/* Main Content Area: sidebar + content */}
      <div className="container mx-auto px-6 lg:px-8 py-4 lg:py-8 max-w-[1440px] flex-1 w-full">
        <div className="flex flex-col lg:flex-row gap-8 lg:gap-10">

          {/* ── Sidebar ─────────────────────────────────── */}
          <aside className="w-full lg:w-60 flex-shrink-0 lg:sticky lg:top-6 lg:self-start rounded-2xl p-2 -m-2 transition-shadow duration-300 ease-out hover:shadow-md">
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-3 px-1">Categories</p>

            {/* Private / Shared toggle */}
            <div className="flex p-1 bg-white border border-gray-200 rounded-xl mb-5 shadow-sm">
              {['private', 'shared'].map((v) => (
                <button
                  key={v}
                  onClick={() => setVisibility(v)}
                  className={`flex-1 py-2 text-sm font-semibold rounded-lg capitalize transition-all ${
                    visibility === v ? 'bg-[#FA6C43] text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>

            {/* Category list */}
            <nav className="space-y-1">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.key}
                  onClick={() => setCategory(cat.key)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 text-sm rounded-xl transition-colors ${
                    category === cat.key
                      ? 'bg-white text-[#FA6C43] font-bold shadow-sm border border-[#FA6C43]/20'
                      : 'text-gray-500 hover:bg-white/60 hover:text-gray-700 font-medium'
                  }`}
                >
                  <span>{cat.label}</span>
                  <span className={`text-xs font-semibold ${category === cat.key ? 'text-[#FA6C43]' : 'text-gray-400'}`}>
                    {counts[cat.key]}
                  </span>
                </button>
              ))}
            </nav>
          </aside>

          {/* ── Content ─────────────────────────────────── */}
          <main className="flex-1 min-w-0">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
              <div className="min-w-0">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#222]">AI Assistants</h1>
                <p className="text-gray-500 text-sm mt-1.5 font-medium max-w-xl">
                  Discover and create your own assistants by blending instructions, knowledge, and multi-step actions.
                </p>
              </div>

              <div className="flex items-center gap-3 flex-shrink-0">
                {/* View toggle — Apple-style: a single pill slides between
                    the two segments instead of each toggling its own bg. */}
                <div className="relative flex p-1 bg-white border border-gray-200 rounded-xl shadow-sm">
                  {/* Sliding indicator (springy glide w/ slight overshoot) */}
                  <span
                    aria-hidden="true"
                    className="absolute top-1 bottom-1 left-1 w-9 rounded-lg bg-[#F0F6FB]"
                    style={{
                      transform: view === 'grid' ? 'translateX(100%)' : 'translateX(0)',
                      transition: 'transform 350ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                    }}
                  />
                  <button
                    onClick={() => setView('list')}
                    title="List view"
                    className={`relative z-10 w-9 h-9 flex items-center justify-center rounded-lg transition-colors duration-200 ${view === 'list' ? 'text-[#FA6C43]' : 'text-gray-400 hover:text-gray-600'}`}
                  >
                    <FaList className="text-sm" />
                  </button>
                  <button
                    onClick={() => setView('grid')}
                    title="Grid view"
                    className={`relative z-10 w-9 h-9 flex items-center justify-center rounded-lg transition-colors duration-200 ${view === 'grid' ? 'text-[#FA6C43]' : 'text-gray-400 hover:text-gray-600'}`}
                  >
                    <FaThLarge className="text-sm" />
                  </button>
                </div>

                {/* Keyboard-free way in to the same flow as Ctrl+V. */}
                <button
                  className="flex items-center justify-center px-4 py-2.5 bg-white border border-gray-200 text-gray-600 rounded-xl hover:border-[#FA6C43]/40 hover:text-[#FA6C43] transition-all duration-200 shadow-sm active:scale-[0.98]"
                  onClick={handleMenuPaste}
                  title="Paste a copied assistant (Ctrl+V)"
                >
                  <FaPaste className="mr-2 text-sm" />
                  <span className="font-bold text-[14px]">Paste</span>
                </button>

                {/* For the professor staring at a blank list: start from the syllabus
                    they already have rather than from a decision they can't yet make. */}
                <button
                  className="flex items-center justify-center px-4 py-2.5 bg-white border border-gray-200 text-gray-600 rounded-xl hover:border-[#FA6C43]/40 hover:text-[#FA6C43] transition-all duration-200 shadow-sm active:scale-[0.98]"
                  onClick={() => navigate('/course-plan')}
                  title="Upload your syllabus and see which classes ACTR fits"
                >
                  <FaListAlt className="mr-2 text-sm" />
                  <span className="font-bold text-[14px]">Plan from syllabus</span>
                </button>

                <button
                  className="flex items-center justify-center px-5 py-2.5 bg-[#FA6C43] hover:bg-[#E55B34] text-white rounded-xl transition-all duration-200 shadow-sm active:scale-[0.98]"
                  onClick={handleCreateNew}
                >
                  <FaPlus className="mr-2 text-sm" />
                  <span className="font-bold text-[14px]">New Assistant</span>
                </button>
              </div>
            </div>

            {/* States */}
            {loading ? (
              <div className="flex flex-col items-center justify-center h-64 rounded-[2rem] bg-white border border-gray-100 shadow-sm">
                <FaSpinner className="animate-spin text-4xl text-[#FA6C43] mb-4" />
                <p className="text-gray-500 font-medium">Loading your AI assistants...</p>
              </div>
            ) : error ? (
              <div className="rounded-[1.5rem] bg-red-50 border border-red-200 p-6">
                <div className="flex items-start">
                  <div className="flex-shrink-0 pt-0.5">
                    <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <h3 className="text-base font-bold text-red-800">Configuration Error</h3>
                    <p className="mt-1 text-sm text-red-600 font-medium">{error}</p>
                  </div>
                </div>
              </div>
            ) : visible.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 rounded-[2rem] bg-white border border-gray-100 shadow-sm">
                <div className="p-6 bg-[#F0F6FB] rounded-full mb-5 text-[#FA6C43]">
                  <FaRobot className="text-4xl" />
                </div>
                <h3 className="text-xl font-bold text-[#222] mb-2">
                  {configs.length === 0 ? 'No assistants yet' : 'Nothing here'}
                </h3>
                <p className="text-gray-500 mb-8 max-w-md text-center font-medium">
                  {configs.length === 0
                    ? 'Create your first AI assistant to take charge of your classroom.'
                    : 'No assistants match this filter. Try a different category or visibility.'}
                </p>
                <button
                  onClick={handleCreateNew}
                  className="px-6 py-3 bg-[#FA6C43] hover:bg-[#E55B34] text-white rounded-xl transition-colors flex items-center shadow-sm font-bold active:scale-[0.98]"
                >
                  <FaPlus className="mr-2" />
                  Create Assistant
                </button>
              </div>
            ) : (
              <div className="space-y-10 pb-20">
                {sections.map((section) => (
                  <section key={section.key}>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-4">{section.label}</p>
                    <div className={view === 'grid' ? 'grid grid-cols-1 xl:grid-cols-2 gap-5' : 'flex flex-col gap-4'}>
                      {section.items.map((config, idx) => (
                        <ConfigItem
                          key={config._id || config.config_id}
                          config={config}
                          index={idx}
                          view={view}
                          onOpen={handleOpen}
                          onSelect={(c) => setSelectedId(c.config_id || c._id)}
                          onResponses={handleResponses}
                          onEdit={onEdit}
                          onDelete={handleDelete}
                          onCopy={handleCopy}
                          onHover={(c) => { hoveredRef.current = c; }}
                          onCardMenu={handleCardMenu}
                          isSelected={selectedId === (config.config_id || config._id)}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </main>
        </div>
      </div>

      {/* Mount Modals */}
      <ConfigModal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
      />

      <ReportBugModal
        isOpen={isBugModalOpen}
        onClose={() => setIsBugModalOpen(false)}
      />

      <PasteConfigModal
        isOpen={pasteOpen}
        token={pasteToken}
        preview={pastePreview}
        loadError={pasteLoadError}
        onResolveToken={openPasteDialog}
        onClose={() => setPasteOpen(false)}
        onCreated={handlePasted}
      />

      <ContextMenu
        menu={contextMenu}
        items={contextMenuItems}
        onClose={() => setContextMenu(null)}
      />

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 max-w-[90vw] bg-gray-900 text-white text-sm font-medium px-6 py-3 rounded-xl shadow-xl z-[130] animate-in zoom-in-95 duration-200">
          {toast}
        </div>
      )}

    </div>
  );
};

export default ConfigListPage;
