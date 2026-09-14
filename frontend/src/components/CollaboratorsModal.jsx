/* @language JavaScript (React / JSX)  @updated 2026-09-14  @changed New component: add someone to a
   config by email. One modal shared by both entry points (the /config_list card menu and the edit
   page panel), so the two can't drift into saying different things about the same permissions. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FaTimes, FaSpinner, FaUserPlus, FaCrown, FaEnvelope, FaTrash, FaCheck,
} from 'react-icons/fa';
import apiClient from '../api/apiClient';

// What a collaborator may do, stated in the modal itself. The owner is granting
// real access to student data here, so the scope is spelled out at the moment of
// granting rather than left to be discovered.
const SCOPE_LINE = 'Collaborators can edit this assistant, share it with a class, and see its results. Only you can delete it or change who has access.';

/* One person (or pending invitation) in the access list. Split out because the
   three states — owner, active collaborator, unredeemed invite — differ only in
   their badge and whether a remove button is offered. */
const PersonRow = ({ person, canManage, busy, onRemove }) => {
  const isOwner = person.role === 'owner';
  const isPending = person.status === 'pending';
  return (
    <div className="flex items-center gap-3 px-3.5 py-3 rounded-xl border border-gray-200 bg-white">
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs ${
        isOwner ? 'bg-[#F9D0C4]/50 text-[#C2410C]'
          : isPending ? 'bg-gray-100 text-gray-400' : 'bg-gray-100 text-gray-500'
      }`}>
        {isOwner ? <FaCrown /> : isPending ? <FaEnvelope /> : (person.username || person.email || '?').charAt(0).toUpperCase()}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#222] truncate">
          {person.username || person.email || 'Unknown'}
        </p>
        {person.username && person.email && (
          <p className="text-xs text-gray-400 truncate">{person.email}</p>
        )}
      </div>

      {isOwner && (
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#C2410C] px-2 py-1 rounded-md bg-[#F9D0C4]/30">
          Owner
        </span>
      )}
      {isPending && (
        <span
          className="text-[10px] font-bold uppercase tracking-wider text-gray-500 px-2 py-1 rounded-md bg-gray-100"
          title="Invited — they'll get access when they create an account"
        >
          Invited
        </span>
      )}

      {/* The owner never gets a remove button for themselves: there is no path in
          this feature that leaves a config without an owner. */}
      {canManage && !isOwner && (
        <button
          onClick={() => onRemove(person)}
          disabled={busy}
          title={isPending ? 'Withdraw invitation' : 'Remove access'}
          className="p-2 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 disabled:opacity-40 transition-colors"
        >
          <FaTrash className="text-xs" />
        </button>
      )}
    </div>
  );
};

const CollaboratorsModal = ({ isOpen, configId, botName, onClose }) => {
  const [people, setPeople] = useState([]);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inputRef = useRef(null);

  /* Load the access list. Also the refresh after every mutation — the server
     returns the new list on add and remove, but re-reading keeps one code path
     for "what does this modal show". */
  const load = useCallback(async () => {
    if (!configId) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await apiClient.get(`/config/${configId}/collaborators`);
      setPeople(data.collaborators || []);
      setIsOwner(Boolean(data.is_owner));
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load the access list.');
    } finally {
      setLoading(false);
    }
  }, [configId]);

  useEffect(() => {
    if (!isOpen) return;
    load();
    setEmail('');
    setNotice('');
  }, [isOpen, load]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  /* Invite by email. The server decides which of the two paths it takes — added
     outright, or an emailed signup link — and says which in `status`, so the
     confirmation can tell the owner what actually happened rather than guessing
     from whether the address looked familiar. */
  const submit = async (e) => {
    e?.preventDefault();
    const value = email.trim();
    if (!value || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { data } = await apiClient.post(`/config/${configId}/collaborators`, { email: value });
      setPeople(data.collaborators || []);
      setEmail('');
      setNotice(data.status === 'invited'
        ? `Invitation sent to ${value}. They'll get access when they create an account.`
        : `${value} now has access.`);
      inputRef.current?.focus();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add them. Try again.');
    } finally {
      setBusy(false);
    }
  };

  /* Remove an active collaborator, or withdraw an invitation that was never
     redeemed. Two endpoints because they address different things — a user id
     versus an invite token — but one action from the owner's side. */
  const remove = async (person) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const url = person.status === 'pending'
        ? `/config/${configId}/invites/${encodeURIComponent(person.token)}`
        : `/config/${configId}/collaborators/${encodeURIComponent(person.user_id)}`;
      const { data } = await apiClient.delete(url);
      setPeople(data.collaborators || []);
      setNotice(person.status === 'pending'
        ? 'Invitation withdrawn.'
        : `${person.username || person.email} no longer has access.`);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not remove them.');
    } finally {
      setBusy(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] flex flex-col bg-white rounded-3xl border border-gray-200 shadow-2xl animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-[#222] flex items-center gap-2">
              <FaUserPlus className="text-[#FA6C43] text-sm" /> Who can work on this
            </h2>
            <p className="text-xs text-gray-400 mt-0.5 truncate">{botName || 'This assistant'}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:text-[#222] hover:bg-gray-100 transition-colors"
          >
            <FaTimes className="text-sm" />
          </button>
        </div>

        {/* Only the owner gets the invite field. A collaborator still sees the
            list — they need to know who else is in here — but the server would
            refuse the write anyway, so offering the control would be a lie. */}
        {isOwner && (
          <form onSubmit={submit} className="px-6 pb-4">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@university.edu"
                disabled={busy}
                className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#FA6C43]/40 focus:border-[#FA6C43]/50 disabled:opacity-60 transition-all"
              />
              <button
                type="submit"
                disabled={!email.trim() || busy}
                className="px-5 py-2.5 rounded-xl bg-[#FA6C43] hover:bg-[#E55B34] text-white text-sm font-bold shadow-sm disabled:opacity-50 transition-all active:scale-[0.98]"
              >
                {busy ? <FaSpinner className="animate-spin text-sm" /> : 'Invite'}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-gray-400 leading-relaxed">
              No account yet? They'll get an email with a link to create one, and this
              will be waiting in their dashboard.
            </p>
          </form>
        )}

        {error && (
          <div className="mx-6 mb-3 px-4 py-2.5 rounded-xl bg-red-50 border border-red-200 text-sm font-semibold text-red-600">
            {error}
          </div>
        )}
        {notice && (
          <div className="mx-6 mb-3 px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-sm font-semibold text-emerald-700 flex items-center gap-2">
            <FaCheck className="text-xs flex-shrink-0" /> {notice}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-2 scrollbar-thin">
          {loading ? (
            <div className="py-10 text-center text-gray-400">
              <FaSpinner className="animate-spin mx-auto text-lg" />
            </div>
          ) : (
            people.map((p) => (
              <PersonRow
                key={p.user_id || p.token || p.email}
                person={p}
                canManage={isOwner}
                busy={busy}
                onRemove={remove}
              />
            ))
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100">
          <p className="text-[11px] text-gray-400 leading-relaxed">{SCOPE_LINE}</p>
        </div>
      </div>
    </div>
  );
};

export default CollaboratorsModal;
