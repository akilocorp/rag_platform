import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FaArrowLeft, FaDownload, FaSpinner, FaChevronDown, FaChevronUp, FaUser } from 'react-icons/fa';
import apiClient from '../api/apiClient';

const chunkArray = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const formatDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
};

const extractText = (msg) => {
  const content = msg?.data?.content ?? msg?.content ?? '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(b => b?.text ?? '').join(' ');
  return '';
};

const extractRole = (msg) => msg?.type === 'human' ? 'Student' : 'AI';

const TranscriptView = ({ sessionId }) => {
  const [messages, setMessages] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient.get(`/history/${sessionId}`)
      .then(res => setMessages(res.data.history || []))
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) return (
    <div className="flex justify-center py-6">
      <FaSpinner className="animate-spin text-[#FA6C43] text-xl" />
    </div>
  );

  if (!messages.length) return <p className="text-sm text-gray-400 py-4 text-center">No messages found.</p>;

  return (
    <div className="space-y-3 py-4 max-h-96 overflow-y-auto pr-2">
      {messages.map((msg, i) => {
        const role = extractRole(msg);
        const text = extractText(msg);
        if (!text) return null;
        return (
          <div key={i} className={`flex gap-3 ${role === 'AI' ? 'flex-row-reverse' : ''}`}>
            <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${role === 'AI' ? 'bg-[#FA6C43] text-white' : 'bg-gray-200 text-gray-600'}`}>
              {role === 'AI' ? 'AI' : <FaUser className="text-[10px]" />}
            </div>
            <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm ${role === 'AI' ? 'bg-[#FA6C43]/10 text-gray-800 rounded-tr-sm' : 'bg-gray-100 text-gray-800 rounded-tl-sm'}`}>
              {text}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const ResponsesPage = () => {
  const { configId } = useParams();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [configName, setConfigName] = useState('');
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [csvLoading, setCsvLoading] = useState(false);
  const [csvProgress, setCsvProgress] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('jwtToken');
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      apiClient.get(`/config/${configId}/sessions`, { headers }),
      apiClient.get(`/config/${configId}`, { headers }).catch(() => ({ data: null }))
    ]).then(([sessRes, cfgRes]) => {
      setSessions(sessRes.data.sessions || []);
      setConfigName(cfgRes.data?.config?.bot_name || 'Assistant');
    }).catch(err => {
      if (err.response?.status === 403) navigate('/config_list');
    }).finally(() => setLoading(false));
  }, [configId, navigate]);

  const anonLabel = useCallback((sessions) => {
    let counter = 1;
    return sessions.map(s => ({
      ...s,
      displayName: s.user_email || `Anonymous #${counter++}`
    }));
  }, []);

  const labeledSessions = anonLabel(sessions);
  const uniqueStudents = new Set(sessions.filter(s => s.user_email).map(s => s.user_email)).size;

  const handleExportCsv = async () => {
    setCsvLoading(true);
    setCsvProgress('Fetching transcripts…');
    try {
      const chunks = chunkArray(labeledSessions, 10);
      const allRows = [];
      let done = 0;

      for (const chunk of chunks) {
        const results = await Promise.all(
          chunk.map(s =>
            apiClient.get(`/history/${s.session_id}`)
              .then(r => r.data.history || [])
              .catch(() => [])
          )
        );
        chunk.forEach((s, i) => {
          const transcript = results[i]
            .map(m => `[${extractRole(m)}]: ${extractText(m)}`)
            .filter(Boolean)
            .join('\n');
          allRows.push([s.session_id, s.displayName, s.timestamp, s.message_count, s.title || '', transcript]);
        });
        done += chunk.length;
        setCsvProgress(`Fetching transcripts… ${done}/${labeledSessions.length}`);
      }

      const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const header = ['Session ID', 'Student', 'Date', 'Messages', 'Title', 'Transcript'];
      const csv = [header, ...allRows].map(row => row.map(escape).join(',')).join('\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${configName.replace(/\s+/g, '_')}_responses.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setCsvLoading(false);
      setCsvProgress('');
    }
  };

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB]">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 lg:px-10 py-4 flex items-center gap-4">
        <button onClick={() => navigate('/config_list')} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors">
          <FaArrowLeft />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-[#222] truncate">{configName} — Responses</h1>
          {!loading && (
            <p className="text-xs text-gray-400 font-medium mt-0.5">
              {sessions.length} total session{sessions.length !== 1 ? 's' : ''} · {uniqueStudents} identified student{uniqueStudents !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <button
          onClick={handleExportCsv}
          disabled={csvLoading || loading || sessions.length === 0}
          className="flex items-center gap-2 px-4 py-2 text-sm font-bold bg-[#FA6C43] hover:bg-[#E55B34] text-white rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {csvLoading ? <FaSpinner className="animate-spin text-sm" /> : <FaDownload className="text-sm" />}
          {csvLoading ? csvProgress : 'Export CSV'}
        </button>
      </div>

      {/* Table */}
      <div className="max-w-5xl mx-auto px-6 lg:px-10 py-8">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 bg-white rounded-[2rem] border border-gray-100">
            <FaSpinner className="animate-spin text-4xl text-[#FA6C43] mb-4" />
            <p className="text-gray-500 font-medium">Loading sessions…</p>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 bg-white rounded-[2rem] border border-gray-100">
            <div className="text-5xl mb-4">📭</div>
            <h3 className="text-xl font-bold text-[#222] mb-2">No sessions yet</h3>
            <p className="text-gray-500 text-sm">Students haven't used this assistant yet.</p>
          </div>
        ) : (
          <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_180px_70px_1fr_40px] gap-4 px-6 py-3 border-b border-gray-100 bg-gray-50 text-xs font-bold text-gray-500 uppercase tracking-wider">
              <span>Student</span>
              <span>Date</span>
              <span>Msgs</span>
              <span>Title</span>
              <span></span>
            </div>

            {labeledSessions.map((s) => (
              <div key={s.session_id} className="border-b border-gray-50 last:border-b-0">
                <button
                  className="w-full grid grid-cols-[1fr_180px_70px_1fr_40px] gap-4 px-6 py-4 text-left hover:bg-gray-50 transition-colors items-center"
                  onClick={() => setExpandedId(expandedId === s.session_id ? null : s.session_id)}
                >
                  <span className="text-sm font-semibold text-[#222] truncate">{s.displayName}</span>
                  <span className="text-sm text-gray-500">{formatDate(s.timestamp)}</span>
                  <span className="text-sm text-gray-500">{s.message_count}</span>
                  <span className="text-sm text-gray-400 truncate">{s.title || '—'}</span>
                  <span className="text-gray-400 flex justify-end">
                    {expandedId === s.session_id ? <FaChevronUp className="text-xs" /> : <FaChevronDown className="text-xs" />}
                  </span>
                </button>

                {expandedId === s.session_id && (
                  <div className="px-6 pb-4 border-t border-gray-100 bg-gray-50/50">
                    <TranscriptView sessionId={s.session_id} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ResponsesPage;
