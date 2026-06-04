import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaArrowLeft, FaSpinner, FaSearch, FaCheckCircle } from 'react-icons/fa';
import apiClient from '../api/apiClient';

const ROLES = ['professor', 'student', 'admin'];

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

  const filtered = users.filter(u =>
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    u.username.toLowerCase().includes(search.toLowerCase())
  );

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
                      <p className="text-xs text-gray-400 truncate">{user.id}</p>
                    </div>

                    <p className="text-sm text-gray-600 truncate">{user.email}</p>

                    <div>
                      {user.is_verified ? (
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
