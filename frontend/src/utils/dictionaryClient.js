// Free dictionary API client + LocalStorage LRU cache.
//
// Hover-triggered lookups can fire frequently; cache hits avoid hammering
// the public endpoint and feel instant on re-hover. Cap kept modest so we
// stay well under the 5 MB localStorage budget.

const CACHE_KEY = 'dictionary-cache-v1';
const MAX_ENTRIES = 500;

let _mem = null;

const loadCache = () => {
  if (_mem) return _mem;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    _mem = parsed && Array.isArray(parsed.order) && parsed.data
      ? parsed
      : { order: [], data: {} };
  } catch {
    _mem = { order: [], data: {} };
  }
  return _mem;
};

const persistCache = () => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(_mem));
  } catch {
    // Quota exceeded — drop oldest half and retry once.
    if (_mem?.order?.length) {
      const half = Math.floor(_mem.order.length / 2);
      const dropped = _mem.order.splice(0, half);
      for (const k of dropped) delete _mem.data[k];
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(_mem)); } catch { /* give up */ }
    }
  }
};

const cacheGet = (word) => {
  const c = loadCache();
  return Object.prototype.hasOwnProperty.call(c.data, word) ? c.data[word] : null;
};

const cacheSet = (word, value) => {
  const c = loadCache();
  c.data[word] = value;
  const idx = c.order.indexOf(word);
  if (idx >= 0) c.order.splice(idx, 1);
  c.order.push(word);
  while (c.order.length > MAX_ENTRIES) {
    const old = c.order.shift();
    delete c.data[old];
  }
  persistCache();
};

const _inFlight = new Map();

const normalize = (entry, fallbackWord) => {
  if (!entry || typeof entry !== 'object') return null;
  const phonetic =
    entry.phonetic ||
    (Array.isArray(entry.phonetics) ? entry.phonetics.find((p) => p?.text)?.text : '') ||
    '';
  const meanings = (Array.isArray(entry.meanings) ? entry.meanings : [])
    .slice(0, 2)
    .map((m) => ({
      partOfSpeech: m?.partOfSpeech || '',
      definitions: (Array.isArray(m?.definitions) ? m.definitions : [])
        .slice(0, 2)
        .map((d) => d?.definition)
        .filter(Boolean),
    }))
    .filter((m) => m.definitions.length > 0);
  return {
    word: entry.word || fallbackWord,
    phonetic,
    meanings,
  };
};

export const lookupDefinition = async (rawWord) => {
  const word = (rawWord || '').toLowerCase().trim();
  if (!word || !/^[a-z]+$/.test(word)) return { notFound: true };

  const cached = cacheGet(word);
  if (cached !== null) return cached;
  if (_inFlight.has(word)) return _inFlight.get(word);

  const promise = (async () => {
    try {
      const res = await fetch(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
      );
      if (res.status === 404) {
        const value = { notFound: true };
        cacheSet(word, value);
        return value;
      }
      if (!res.ok) return { error: `HTTP ${res.status}` };
      const data = await res.json();
      const entry = Array.isArray(data) ? data[0] : null;
      const value = normalize(entry, word);
      if (!value || value.meanings.length === 0) {
        const nf = { notFound: true };
        cacheSet(word, nf);
        return nf;
      }
      cacheSet(word, value);
      return value;
    } catch (e) {
      return { error: e?.message || 'Network error' };
    } finally {
      _inFlight.delete(word);
    }
  })();

  _inFlight.set(word, promise);
  return promise;
};
