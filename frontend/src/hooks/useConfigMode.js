// @language  JavaScript (React)
// @updated   2026-07-19
// @changed   New hook: faculty Simple/Advanced config-mode preference, localStorage-backed with cross-component sync.
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'facultyConfigMode';
const EVENT = 'facultyconfigmodechange';

// Reads the persisted preference, defaulting to 'simple' for everyone.
export const readConfigMode = () =>
  (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === 'advanced')
    ? 'advanced'
    : 'simple';

// Faculty-wide Simple/Advanced preference. Persisted per-device in localStorage
// and broadcast on a window event so every mounted consumer (navbar toggle,
// create modal, edit form) stays in sync without a global context/provider.
// `storage` covers other-tab changes; the custom event covers this tab.
export default function useConfigMode() {
  const [mode, setModeState] = useState(readConfigMode);

  useEffect(() => {
    const sync = () => setModeState(readConfigMode());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  // Persist + broadcast; the same tab hears the event via the listener above.
  const setMode = useCallback((next) => {
    const val = next === 'advanced' ? 'advanced' : 'simple';
    localStorage.setItem(STORAGE_KEY, val);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { mode, setMode, advanced: mode === 'advanced' };
}
