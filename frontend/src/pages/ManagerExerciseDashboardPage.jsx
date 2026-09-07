/* @language JSX  @updated 2026-09-07  @changed New page: the professor's live-class control panel for a
   manager exercise, reached from the config list's "Open Dashboard" button (previously that button opened
   the student-facing exercise itself — manager_exercise had no faculty dashboard at all). Template-specific:
   `investigation` gets the "Pair the class" panel (headcount + Start Pairing + quits, moved here from
   EditConfigPage.jsx's Customize page, which is authoring-only now); every other template (hiring) gets a
   live breakout-room monitor with owner-only reset, reusing the same `list_breakout_rooms` /
   `reset_breakout_room` socket events ManagerExercisePage.jsx's lobby already uses for the same purpose. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import {
  FaArrowLeft, FaTachometerAlt, FaUsers, FaSpinner, FaChartBar,
  FaExternalLinkAlt, FaRedo, FaCheck,
} from 'react-icons/fa';
import apiClient from '../api/apiClient';
import axios from 'axios';
import UserInfo from '../components/UserInfo';

const getToken = () => localStorage.getItem('jwtToken') || localStorage.getItem('access_token');

// ---------------------------------------------------------------------------
// Investigation template: pairing panel
// ---------------------------------------------------------------------------
// Polled over plain HTTP rather than pushed over a socket — this page has no
// live connection of its own for the pool, and a professor watching a
// headcount before pressing one button doesn't need sub-second latency for it.
const PairingPanel = ({ configId }) => {
  const [poolStatus, setPoolStatus] = useState(null);
  const [pairBusy, setPairBusy] = useState(false);
  const [pairErr, setPairErr] = useState('');

  useEffect(() => {
    if (!configId) return;
    let cancelled = false;
    const poll = () => {
      apiClient.get(`/manager-exercise/${configId}/pool-status`)
        .then(res => { if (!cancelled) setPoolStatus(res.data); })
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 4000);
    return () => { cancelled = true; clearInterval(id); };
  }, [configId]);

  const startPairing = async () => {
    setPairBusy(true);
    setPairErr('');
    try {
      await apiClient.post(`/manager-exercise/${configId}/pair`);
      const res = await apiClient.get(`/manager-exercise/${configId}/pool-status`);
      setPoolStatus(res.data);
    } catch (e) {
      setPairErr(e?.response?.data?.error || 'Could not pair the class.');
    } finally {
      setPairBusy(false);
    }
  };

  return (
    <div className="rounded-3xl border-2 border-dashed border-[#FA6C43]/40 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-gray-800 inline-flex items-center gap-2">
            <FaUsers className="text-[#FA6C43]" /> Pair the class
          </h2>
          <p className="text-xs text-gray-500 mt-1.5 max-w-lg leading-relaxed">
            Students who open this exercise wait quietly until you pair them — there is no
            lobby for this template. Pairing splits everyone waiting into groups of 3 (one
            case file each) and starts every group's reading clock at once. Anyone who joins
            afterward is slotted into an existing group automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={startPairing}
          disabled={pairBusy || !configId || poolStatus?.paired || !poolStatus?.count}
          className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-[#FA6C43] hover:bg-[#E55B34] text-white font-bold text-sm px-5 py-3 shadow-sm disabled:opacity-50 transition-all active:scale-95"
        >
          {pairBusy
            ? <><FaSpinner className="animate-spin" /> Pairing…</>
            : poolStatus?.paired ? <><FaCheck /> Paired</> : 'Start pairing'}
        </button>
      </div>

      <p className="mt-5 text-base font-semibold text-gray-700">
        {poolStatus == null
          ? 'Checking who has joined…'
          : poolStatus.paired
            ? `Paired into ${poolStatus.group_count} group${poolStatus.group_count === 1 ? '' : 's'}.`
            : `${poolStatus.count} student${poolStatus.count === 1 ? '' : 's'} waiting to be paired.`}
      </p>
      {pairErr && <p className="mt-2 text-xs font-semibold text-red-500">{pairErr}</p>}

      {poolStatus?.quits?.length > 0 && (
        <div className="mt-5 pt-4 border-t border-gray-100">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">
            Left the exercise
          </p>
          <div className="space-y-1">
            {poolStatus.quits.slice(0, 8).map((q, i) => (
              <p key={i} className="text-xs text-gray-600">
                <span className="font-semibold">{q.name}</span> quit
                {q.room_id ? ` (${q.room_id.split('_').pop()})` : ''}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Every other template (hiring): a live view of the self-service breakout
// lobby, with owner-only reset — the same controls a professor could already
// reach by opening the exercise's own URL directly (bootstrap detects
// ownership there), surfaced here instead so "Open Dashboard" is the one
// place to go regardless of template.
// ---------------------------------------------------------------------------
const RoomMonitor = ({ configId }) => {
  const [rooms, setRooms] = useState(null);
  const [confirmReset, setConfirmReset] = useState(null);
  const [resettingRoom, setResettingRoom] = useState(null);
  const [roomError, setRoomError] = useState('');
  const socketRef = useRef(null);

  useEffect(() => {
    if (!configId) return;
    // One persistent connection for both listening and emitting: the backend's
    // `breakout_reset` acknowledgment is sent only `to=request.sid` — the socket
    // that actually asked — so resetting through a second, throwaway socket would
    // leave this one's confirm/spinner state stuck forever.
    const socket = io('/', { path: '/socket.io' });
    socketRef.current = socket;
    socket.on('connect', () => socket.emit('list_breakout_rooms', { config_id: configId }));
    socket.on('breakout_rooms', (d) => setRooms(Array.isArray(d.rooms) ? d.rooms : []));
    socket.on('breakout_reset', () => { setResettingRoom(null); setConfirmReset(null); setRoomError(''); });
    socket.on('breakout_error', (d) => {
      setResettingRoom(null);
      setConfirmReset(null);
      setRoomError(d?.reason === 'unauthorized'
        ? "You don't have permission to reset that group."
        : 'Could not reset that group — try again.');
    });
    return () => socket.disconnect();
  }, [configId]);

  const resetRoom = (index) => {
    if (confirmReset !== index) { setConfirmReset(index); return; }
    setResettingRoom(index);
    socketRef.current?.emit('reset_breakout_room', { config_id: configId, room_index: index, token: getToken() });
  };

  if (rooms == null) {
    return (
      <div className="rounded-3xl border border-gray-200 bg-white p-10 flex items-center justify-center text-gray-400">
        <FaSpinner className="animate-spin mr-2" /> Loading the class lobby…
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-gray-200 bg-white p-6">
      <h2 className="text-sm font-bold text-gray-800 inline-flex items-center gap-2 mb-1">
        <FaUsers className="text-[#FA6C43]" /> Breakout groups
      </h2>
      <p className="text-xs text-gray-500 mb-5">
        Students pick their own group and start when they're ready — there is nothing to start
        here. Reset wipes a group back to an empty slot, including its transcript.
      </p>
      {roomError && <p className="mb-4 text-xs font-semibold text-red-500">{roomError}</p>}
      <div className="grid sm:grid-cols-2 gap-3">
        {rooms.map((r) => {
          const resettable = r.phase === 'done' || r.started || r.occupants > 0;
          const isConfirming = confirmReset === r.index;
          const isResetting = resettingRoom === r.index;
          return (
            <div key={r.room_id} className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-sm">{r.label}</span>
                <span className={`text-[10px] font-bold uppercase tracking-wider ${
                  r.phase === 'done' ? 'text-emerald-600' : r.started ? 'text-[#C2410C]' : 'text-gray-400'
                }`}>
                  {r.phase === 'done' ? 'Finished' : r.started ? r.phase : 'Waiting'}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">{r.occupants} / {r.capacity} students</p>
              {r.names?.length > 0 && (
                <p className="text-[11px] text-gray-400 mt-1 truncate">{r.names.join(', ')}</p>
              )}
              {resettable && (
                <button
                  type="button"
                  onClick={() => resetRoom(r.index)}
                  disabled={isResetting}
                  className={`mt-3 inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                    isConfirming ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-white border border-gray-200 text-gray-500 hover:text-red-500 hover:border-red-200'
                  }`}
                >
                  {isResetting ? <FaSpinner className="animate-spin" /> : <FaRedo />}
                  {isConfirming ? 'Confirm reset?' : 'Reset'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default function ManagerExerciseDashboardPage() {
  const { configId } = useParams();
  const navigate = useNavigate();
  const [config, setConfig] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const token = getToken();
      const res = await axios.get(`/api/config/${configId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      setConfig(res.data.config);
    } catch (e) {
      setError(e?.response?.data?.error || 'Could not load this exercise.');
    }
  }, [configId]);

  useEffect(() => { load(); }, [load]);

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F0F6FB] px-6 text-center">
        <p className="text-sm font-semibold text-red-500 mb-4">{error}</p>
        <button onClick={() => navigate(-1)} className="text-sm font-semibold text-gray-500 hover:text-[#FA6C43]">
          <FaArrowLeft className="inline mr-1.5 text-xs" /> Back
        </button>
      </div>
    );
  }
  if (!config) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F0F6FB] text-gray-400">
        <FaSpinner className="animate-spin mr-2" /> Loading dashboard…
      </div>
    );
  }

  const template = config.manager_exercise?.template === 'investigation' ? 'investigation' : 'hiring';

  return (
    <div className="min-h-screen bg-[#F0F6FB] text-[#222]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <header className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-white/95 backdrop-blur sticky top-0 z-10 h-16 shadow-sm">
        <div className="flex items-center gap-4 min-w-0">
          <button onClick={() => navigate('/config_list')} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
            <FaArrowLeft />
          </button>
          <div className="p-2 rounded-lg bg-gray-100 text-[#1F1F1F]"><FaTachometerAlt className="text-lg" /></div>
          <div className="min-w-0">
            <h1 className="font-semibold text-base truncate">{config.bot_name || 'Manager Exercise'}</h1>
            <p className="text-[11px] font-semibold text-gray-400">Dashboard</p>
          </div>
        </div>
        <UserInfo />
      </header>

      <main className="p-4 sm:p-6 lg:px-12 xl:px-20">
        <div className="max-w-3xl mx-auto py-6 space-y-5">
          {template === 'investigation'
            ? <PairingPanel configId={configId} />
            : <RoomMonitor configId={configId} />}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => navigate(`/manager-exercise/${configId}/results`)}
              className="flex-1 min-w-[200px] inline-flex items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white px-5 py-3.5 text-sm font-bold text-gray-700 hover:border-[#FA6C43] hover:text-[#FA6C43] transition-colors"
            >
              <FaChartBar /> See students' results
            </button>
            <button
              type="button"
              onClick={() => navigate(`/manager-exercise/${configId}`)}
              className="flex-1 min-w-[200px] inline-flex items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white px-5 py-3.5 text-sm font-bold text-gray-700 hover:border-[#FA6C43] hover:text-[#FA6C43] transition-colors"
            >
              <FaExternalLinkAlt className="text-xs" /> Preview the exercise
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
