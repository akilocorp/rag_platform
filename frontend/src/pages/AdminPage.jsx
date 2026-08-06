// @language  JavaScript (React / JSX)
// @updated   2026-08-06
// @changed   Create-an-account now takes the person's school and school ID; the list shows both
//            under the username and the search box matches on them.
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaArrowLeft, FaSpinner, FaSearch, FaCheckCircle, FaUserPlus, FaCopy, FaCheck, FaTimes, FaKey } from 'react-icons/fa';
import apiClient from '../api/apiClient';

const ROLES = ['professor', 'student', 'admin'];

// Shown once, immediately after an account is created. The plaintext password
// exists nowhere else — not in the database, not in a log — so this dialog is
// deliberately blunt about that being the only chance to copy it.
const NewAccountModal = ({ account, onClose }) => {
  const [copied, setCopied] = useState(false);
  if (!account) return null;

  const copy = () => {
    navigator.clipboard?.writeText(account.one_time_password).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-[1.75rem] shadow-2xl w-full max-w-lg p-8 relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-5 right-5 p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-all">
          <FaTimes />
        </button>

        <div className="w-12 h-12 rounded-full bg-[#FFF5F2] flex items-center justify-center mb-4">
          <FaKey className="text-[#FA6C43]" />
        </div>
        <h2 className="text-xl font-extrabold text-[#222] mb-1">Account ready</h2>
        <p className="text-sm text-gray-500 mb-5">
          <span className="font-semibold text-gray-700">{account.user.email}</span> is verified and can log in now.
          Give them this one-time password — they’ll be asked to set their own before they can do anything else.
        </p>

        <div className="flex items-center gap-2 mb-3">
          <code className="flex-1 text-base font-bold tracking-wider text-gray-800 bg-[#FFF5F2] border border-[#FA6C43]/20 px-4 py-3 rounded-xl text-center">
            {account.one_time_password}
          </code>
          <button
            onClick={copy}
            className="px-4 py-3 rounded-xl bg-[#FA6C43] text-white text-sm font-semibold flex items-center gap-2 shrink-0 hover:bg-[#E55B34] transition-colors"
          >
            {copied ? <FaCheck /> : <FaCopy />} {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        <p className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6">
          This is the only time it’s shown. If it’s lost, they can use “Forgot password” on the login page.
        </p>

        <button
          onClick={onClose}
          className="w-full py-3 px-6 rounded-xl font-bold border-2 border-gray-200 text-gray-700 bg-white hover:bg-gray-50 transition-all"
        >
          Done
        </button>
      </div>
    </div>
  );
};

const ROLE_COLORS = {
  professor: 'bg-blue-100 text-blue-700',
  student: 'bg-green-100 text-green-700',
  admin: 'bg-purple-100 text-purple-700',
};

const AdminPage = () => {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState({});   // { userId: true }
  const [toast, setToast] = useState(null);   // { message, type }
  const [settings, setSettings] = useState(null);     // usage limits config
  const [savingSettings, setSavingSettings] = useState(false);
  const [newTier, setNewTier] = useState({ name: '', messages_per_student: '' });
  const [newAccount, setNewAccount] = useState({ email: '', username: '', role: 'professor', university: '', school_id: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createdAccount, setCreatedAccount] = useState(null);  // drives the one-time password dialog

  const authHeaders = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('jwtToken')}` } });

  useEffect(() => {
    const token = localStorage.getItem('jwtToken');
    apiClient.get('/admin/users', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => setUsers(res.data.users || []))
      .catch(err => {
        if (err.response?.status === 403) {
          setError('You do not have admin access.');
        } else {
          setError('Failed to load users.');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    apiClient.get('/admin/usage/settings', authHeaders())
      .then(res => setSettings(res.data))
      .catch(() => {});
  }, []);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const res = await apiClient.put('/admin/usage/settings', {
        anon_lifetime_cap: Number(settings.anon_lifetime_cap),
        student_default_cap: Number(settings.student_default_cap),
        professor_default_cap: Number(settings.professor_default_cap),
        warn_threshold: Number(settings.warn_threshold),
      }, authHeaders());
      setSettings(res.data);
      showToast('Usage settings saved');
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to save settings', 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const addTier = async () => {
    if (!newTier.name.trim() || !newTier.messages_per_student) return;
    try {
      const res = await apiClient.post('/admin/usage/tiers', {
        name: newTier.name.trim(),
        messages_per_student: Number(newTier.messages_per_student),
      }, authHeaders());
      setSettings(res.data);
      setNewTier({ name: '', messages_per_student: '' });
      showToast('Tier added');
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to add tier', 'error');
    }
  };

  const deleteTier = async (id) => {
    try {
      const res = await apiClient.delete(`/admin/usage/tiers/${id}`, authHeaders());
      setSettings(res.data);
      showToast('Tier removed');
    } catch (err) {
      showToast('Failed to remove tier', 'error');
    }
  };

  // Opens an account outright: no invite, no verification email. The response
  // carries the generated password, which is why it goes to the dialog rather
  // than just a toast.
  const createAccount = async (e) => {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setCreateError('');
    try {
      const { data } = await apiClient.post('/admin/users', {
        email: newAccount.email.trim(),
        username: newAccount.username.trim(),
        role: newAccount.role,
        university: newAccount.university.trim(),
        school_id: newAccount.school_id.trim(),
      }, authHeaders());
      setUsers(prev => [...prev, data.user].sort((a, b) => a.email.localeCompare(b.email)));
      setCreatedAccount(data);
      setNewAccount({ email: '', username: '', role: 'professor', university: '', school_id: '' });
    } catch (err) {
      setCreateError(err.response?.data?.error || 'Could not create the account.');
    } finally {
      setCreating(false);
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    setSaving(prev => ({ ...prev, [userId]: true }));
    try {
      const token = localStorage.getItem('jwtToken');
      await apiClient.put(`/admin/users/${userId}/role`, { role: newRole }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
      showToast('Role updated');
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to update role', 'error');
    } finally {
      setSaving(prev => ({ ...prev, [userId]: false }));
    }
  };

  // School and school ID join the match so an admin can find someone by the
  // number a registrar gave them, not just by the account they picked.
  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    return [u.email, u.username, u.university, u.school_id]
      .some(field => (field || '').toLowerCase().includes(q));
  });

  const counts = ROLES.reduce((acc, r) => {
    acc[r] = users.filter(u => u.role === r).length;
    return acc;
  }, {});

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB]">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 lg:px-10 py-4 flex items-center gap-4">
        <button onClick={() => navigate('/config_list')} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors">
          <FaArrowLeft />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-[#222]">User Management</h1>
          {!loading && !error && (
            <p className="text-xs text-gray-400 font-medium mt-0.5">
              {users.length} total users · {counts.professor || 0} professors · {counts.student || 0} students · {counts.admin || 0} admins
            </p>
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 lg:px-10 py-8">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 bg-white rounded-[2rem] border border-gray-100">
            <FaSpinner className="animate-spin text-4xl text-[#FA6C43] mb-4" />
            <p className="text-gray-500 font-medium">Loading users…</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-64 bg-white rounded-[2rem] border border-gray-100">
            <div className="text-5xl mb-4">🔒</div>
            <h3 className="text-xl font-bold text-[#222] mb-2">Access Denied</h3>
            <p className="text-gray-500 text-sm">{error}</p>
          </div>
        ) : (
          <>
            {/* Open an account directly — bypasses the email-verification flow
                entirely; the admin vouching for the person is the check. */}
            <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-6 mb-6">
              <h2 className="text-lg font-bold text-[#222] mb-1 flex items-center gap-2">
                <FaUserPlus className="text-[#FA6C43] text-base" /> Create an account
              </h2>
              <p className="text-xs text-gray-400 font-medium mb-5">
                Creates a verified account with a one-time password. No verification email is sent.
              </p>

              {/* Two rows: identity on top, affiliation and the submit below —
                  four text inputs on one line squeezes the email past legible. */}
              <form onSubmit={createAccount} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-[1.4fr_1fr] gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Email</label>
                    <input
                      type="email"
                      required
                      value={newAccount.email}
                      onChange={e => setNewAccount(prev => ({ ...prev, email: e.target.value }))}
                      placeholder="professor@ust.hk"
                      className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#FA6C43] focus:ring-2 focus:ring-[#F9D0C4] transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Username</label>
                    <input
                      type="text"
                      required
                      value={newAccount.username}
                      onChange={e => setNewAccount(prev => ({ ...prev, username: e.target.value }))}
                      placeholder="jdoe"
                      className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#FA6C43] focus:ring-2 focus:ring-[#F9D0C4] transition-all"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-[1.4fr_1fr_auto_auto] gap-3 items-end">
                  {/* Optional on purpose: an admin opening a colleague's account
                      usually has neither to hand, and the fields stay editable later. */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">
                      School <span className="font-normal text-gray-400">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={newAccount.university}
                      onChange={e => setNewAccount(prev => ({ ...prev, university: e.target.value }))}
                      placeholder="HKUST"
                      className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#FA6C43] focus:ring-2 focus:ring-[#F9D0C4] transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">
                      School ID <span className="font-normal text-gray-400">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={newAccount.school_id}
                      onChange={e => setNewAccount(prev => ({ ...prev, school_id: e.target.value }))}
                      placeholder="20451234"
                      className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#FA6C43] focus:ring-2 focus:ring-[#F9D0C4] transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Role</label>
                    <select
                      value={newAccount.role}
                      onChange={e => setNewAccount(prev => ({ ...prev, role: e.target.value }))}
                      className="px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-semibold focus:outline-none focus:border-[#FA6C43] focus:ring-2 focus:ring-[#F9D0C4]"
                    >
                      {ROLES.map(r => (
                        <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="submit"
                    disabled={creating || !newAccount.email.trim() || !newAccount.username.trim()}
                    className="px-5 py-2.5 bg-[#FA6C43] hover:bg-[#E55B34] text-white text-sm font-bold rounded-xl disabled:opacity-50 flex items-center gap-2 transition-all active:scale-[0.98]"
                  >
                    {creating && <FaSpinner className="animate-spin text-xs" />}
                    {creating ? 'Creating…' : 'Create'}
                  </button>
                </div>
              </form>

              {createError && (
                <p className="mt-3 text-xs font-semibold text-red-600">{createError}</p>
              )}
            </div>

            {/* Search */}
            <div className="relative mb-6">
              <FaSearch className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by email or username…"
                className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#FA6C43] focus:ring-2 focus:ring-[#F9D0C4] transition-all"
              />
            </div>

            <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm overflow-hidden">
              {/* Table header */}
              <div className="grid grid-cols-[1fr_160px_100px_110px] gap-4 px-6 py-3 border-b border-gray-100 bg-gray-50 text-xs font-bold text-gray-500 uppercase tracking-wider">
                <span>User</span>
                <span>Email</span>
                <span>Status</span>
                <span>Role</span>
              </div>

              {filtered.length === 0 ? (
                <div className="px-6 py-12 text-center text-gray-400 text-sm">No users match your search.</div>
              ) : (
                filtered.map(user => (
                  <div key={user.id} className="grid grid-cols-[1fr_160px_100px_110px] gap-4 px-6 py-4 border-b border-gray-50 last:border-b-0 items-center hover:bg-gray-50/50 transition-colors">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#222] truncate">{user.username}</p>
                      {/* Falls back to the raw id when there's no affiliation to show —
                          every row keeps a second line either way. */}
                      {(user.university || user.school_id) ? (
                        <p className="text-xs text-gray-500 truncate">
                          {[user.university, user.school_id].filter(Boolean).join(' · ')}
                        </p>
                      ) : (
                        <p className="text-xs text-gray-400 truncate">{user.id}</p>
                      )}
                    </div>

                    <p className="text-sm text-gray-600 truncate">{user.email}</p>

                    <div>
                      {/* Still on the password we handed them — worth calling out
                          separately from unverified, since they can't use the app yet. */}
                      {user.must_change_password ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                          <FaKey className="text-[9px]" /> Temp password
                        </span>
                      ) : user.is_verified ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                          <FaCheckCircle className="text-[10px]" /> Verified
                        </span>
                      ) : (
                        <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Unverified</span>
                      )}
                    </div>

                    <div className="relative">
                      {saving[user.id] ? (
                        <div className="flex items-center gap-2 px-3 py-1.5">
                          <FaSpinner className="animate-spin text-[#FA6C43] text-xs" />
                          <span className="text-xs text-gray-400">Saving…</span>
                        </div>
                      ) : (
                        <select
                          value={user.role}
                          onChange={e => handleRoleChange(user.id, e.target.value)}
                          className={`text-xs font-bold px-3 py-1.5 rounded-lg border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] ${ROLE_COLORS[user.role] || 'bg-gray-100 text-gray-600'}`}
                        >
                          {ROLES.map(r => (
                            <option key={r} value={r} className="bg-white text-gray-800 font-normal">
                              {r.charAt(0).toUpperCase() + r.slice(1)}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Usage Limits */}
            {settings && (
              <div className="mt-8 bg-white rounded-[2rem] border border-gray-100 shadow-sm p-6">
                <h2 className="text-lg font-bold text-[#222] mb-1">Usage Limits</h2>
                <p className="text-xs text-gray-400 font-medium mb-5">
                  Message caps (1 message = one model reply). Caps apply across all models.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
                  {[
                    { key: 'anon_lifetime_cap', label: 'Anonymous (lifetime)' },
                    { key: 'student_default_cap', label: 'Student default' },
                    { key: 'professor_default_cap', label: 'Professor default' },
                  ].map(({ key, label }) => (
                    <div key={key}>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">{label}</label>
                      <input
                        type="number" min="0"
                        value={settings[key]}
                        onChange={e => setSettings(s => ({ ...s, [key]: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#FA6C43]"
                      />
                    </div>
                  ))}
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Warn at (0–1)</label>
                    <input
                      type="number" min="0" max="1" step="0.05"
                      value={settings.warn_threshold}
                      onChange={e => setSettings(s => ({ ...s, warn_threshold: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#FA6C43]"
                    />
                  </div>
                </div>

                <button
                  onClick={saveSettings}
                  disabled={savingSettings}
                  className="mb-8 bg-[#FA6C43] hover:bg-[#e85a30] disabled:opacity-60 text-white font-semibold px-5 py-2 rounded-xl text-sm transition-colors"
                >
                  {savingSettings ? 'Saving…' : 'Save settings'}
                </button>

                <h3 className="text-sm font-bold text-[#222] mb-1">Class tiers</h3>
                <p className="text-xs text-gray-400 font-medium mb-3">
                  Professors pick a tier per class. Pool = messages/student × number of students.
                </p>
                <div className="space-y-2 mb-4">
                  {(settings.tiers || []).map(t => (
                    <div key={t.id} className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2">
                      <span className="text-sm font-semibold text-[#222] flex-1">{t.name}</span>
                      <span className="text-xs text-gray-500">{t.messages_per_student} msg / student</span>
                      <button onClick={() => deleteTier(t.id)} className="text-xs font-semibold text-red-500 hover:text-red-700">Remove</button>
                    </div>
                  ))}
                  {(settings.tiers || []).length === 0 && (
                    <p className="text-xs text-gray-400">No tiers yet.</p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Tier name (e.g. Small)"
                    value={newTier.name}
                    onChange={e => setNewTier(t => ({ ...t, name: e.target.value }))}
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#FA6C43]"
                  />
                  <input
                    type="number" min="1"
                    placeholder="msg / student"
                    value={newTier.messages_per_student}
                    onChange={e => setNewTier(t => ({ ...t, messages_per_student: e.target.value }))}
                    className="w-32 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#FA6C43]"
                  />
                  <button
                    onClick={addTier}
                    className="bg-gray-900 hover:bg-gray-700 text-white font-semibold px-4 py-2 rounded-xl text-sm transition-colors"
                  >
                    Add
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <NewAccountModal account={createdAccount} onClose={() => setCreatedAccount(null)} />

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-6 py-3 rounded-xl shadow-xl text-sm font-semibold z-50 transition-all ${
          toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-gray-900 text-white'
        }`}>
          {toast.message}
        </div>
      )}
    </div>
  );
};

export default AdminPage;
