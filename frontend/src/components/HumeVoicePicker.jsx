// @language  JavaScript (React / JSX)
// @updated   2026-09-28
// @changed   New file: the Audio Call voice picker. Lists Hume's voice library from the server, plays a
//            short spoken sample of any voice, and reports the pick as { id, name, provider }. Saving
//            the bot is what creates or re-versions its Hume config (backend: src/audio/hume_configs.py).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FaPlay, FaStop, FaCheck, FaSpinner, FaSearch } from 'react-icons/fa';
import apiClient from '../api/apiClient';

const GENDERS = ['All', 'Female', 'Male'];

const voiceKey = (v) => `${v.provider}:${v.id}`;

const voiceMeta = (v) => [v.gender, v.age, ...(v.accents || []).slice(0, 2)].filter(Boolean).join(' · ');

/**
 * HumeVoicePicker — choose the voice an Audio Call bot speaks with.
 *
 * `value` is the stored `hume_voice` ({ id, name, provider }) or null, which
 * means the bot uses the server's default voice. Previews are fetched once per
 * voice and kept as object URLs for the life of the picker; only one plays at
 * a time.
 */
const HumeVoicePicker = ({ value, onChange }) => {
  const [voices, setVoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [gender, setGender] = useState('All');
  const [playingKey, setPlayingKey] = useState(null);
  const [loadingKey, setLoadingKey] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const audioRef = useRef(null);
  const previewUrls = useRef(new Map());

  useEffect(() => {
    let cancelled = false;
    apiClient.get('/audio/hume/voices')
      .then((res) => { if (!cancelled) setVoices(res.data?.voices || []); })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.error || 'Could not load voices'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    const urls = previewUrls.current;
    return () => {
      cancelled = true;
      audioRef.current?.pause();
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return voices.filter((v) => {
      if (gender !== 'All' && v.gender !== gender) return false;
      if (!q) return true;
      return [v.name, v.gender, v.age, v.language, ...(v.accents || [])]
        .some((s) => (s || '').toLowerCase().includes(q));
    });
  }, [voices, query, gender]);

  const stop = () => {
    audioRef.current?.pause();
    setPlayingKey(null);
  };

  const togglePreview = async (voice) => {
    const key = voiceKey(voice);
    if (playingKey === key) return stop();
    stop();
    setPreviewError(null);
    let url = previewUrls.current.get(key);
    if (!url) {
      setLoadingKey(key);
      try {
        const res = await apiClient.get(
          `/audio/hume/voices/${voice.provider}/${voice.id}/preview`,
          { responseType: 'blob' },
        );
        url = URL.createObjectURL(res.data);
        previewUrls.current.set(key, url);
      } catch (e) {
        setPreviewError(`Could not play ${voice.name}.`);
        return;
      } finally {
        setLoadingKey(null);
      }
    }
    if (!audioRef.current) audioRef.current = new Audio();
    const audio = audioRef.current;
    audio.src = url;
    audio.onended = () => setPlayingKey(null);
    setPlayingKey(key);
    audio.play().catch(() => setPlayingKey(null));
  };

  const selectedKey = value?.id ? voiceKey({ provider: value.provider || 'HUME_AI', id: value.id }) : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-[13px] font-semibold text-gray-700">Voice</label>
        <span className="text-[11px] text-gray-500">
          {value?.name ? <>Selected: <span className="font-semibold text-[#222]">{value.name}</span></> : 'Using the default voice'}
        </span>
      </div>

      <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
        <div className="flex items-center gap-2 p-2 border-b border-gray-100">
          <div className="relative flex-1 min-w-0">
            <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300 text-xs" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or accent"
              className="w-full pl-8 pr-3 py-2 text-sm rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#F9D0C4]"
            />
          </div>
          <div className="flex rounded-lg bg-gray-100 p-0.5 shrink-0">
            {GENDERS.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGender(g)}
                className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-all ${gender === g ? 'bg-white text-[#FA6C43] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-64 overflow-y-auto custom-scrollbar">
          {loading && (
            <p className="flex items-center gap-2 p-4 text-sm text-gray-400"><FaSpinner className="animate-spin" /> Loading voices…</p>
          )}
          {error && <p className="p-4 text-sm text-[#E5484D]">{error}</p>}
          {!loading && !error && filtered.length === 0 && (
            <p className="p-4 text-sm text-gray-400">No voices match.</p>
          )}
          {filtered.map((v) => {
            const key = voiceKey(v);
            const selected = key === selectedKey;
            return (
              <div
                key={key}
                onClick={() => onChange({ id: v.id, name: v.name, provider: v.provider })}
                className={`flex items-center gap-3 px-3 py-2 cursor-pointer border-b border-gray-50 last:border-b-0 transition-colors ${selected ? 'bg-[#F9D0C4]/30' : 'hover:bg-gray-50'}`}
              >
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); togglePreview(v); }}
                  title={playingKey === key ? 'Stop' : 'Play a sample'}
                  className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center bg-white border border-gray-200 text-[#FA6C43] hover:border-[#FA6C43] transition-colors"
                >
                  {loadingKey === key ? <FaSpinner className="animate-spin text-[10px]" />
                    : playingKey === key ? <FaStop className="text-[10px]" />
                    : <FaPlay className="text-[10px] ml-0.5" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[#222] truncate">
                    {v.name}
                    {v.provider === 'CUSTOM_VOICE' && (
                      <span className="ml-2 text-[10px] font-bold text-[#FA6C43] uppercase">Custom</span>
                    )}
                  </p>
                  <p className="text-[11px] text-gray-500 truncate">{voiceMeta(v)}</p>
                </div>
                {selected && <FaCheck className="text-[#FA6C43] text-xs shrink-0" />}
              </div>
            );
          })}
        </div>
      </div>

      {previewError && <p className="text-xs mt-2 text-[#E5484D]">{previewError}</p>}
      <p className="text-[11px] text-gray-400 mt-2">
        Press play to hear a voice. The voice you pick is used from the next call after you save.
      </p>
    </div>
  );
};

export default HumeVoicePicker;
