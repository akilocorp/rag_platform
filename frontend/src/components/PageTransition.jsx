// @language  JavaScript (React / JSX)
// @updated   2026-08-10
// @changed   Overlay markup + CSS moved into LoadingScreen so guards and pages can render the
//            same loader; this file now only owns the route-change timing.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import LoadingScreen, { pickLoadingAsset, LOADING_FADE_MS } from './LoadingScreen';

const MIN_DURATION_MS = 1100;

export default function PageTransition({ children }) {
  const location = useLocation();
  const firstRenderRef = useRef(true);
  const lastPathRef = useRef(location.pathname);
  const [overlay, setOverlay] = useState(null);

  useLayoutEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      lastPathRef.current = location.pathname;
      return;
    }
    if (lastPathRef.current === location.pathname) return;
    lastPathRef.current = location.pathname;

    setOverlay({ asset: pickLoadingAsset(), phase: 'in' });
  }, [location.pathname]);

  useEffect(() => {
    if (!overlay || overlay.phase !== 'in') return;
    const fadeTimer = setTimeout(() => {
      setOverlay((curr) => (curr ? { ...curr, phase: 'out' } : curr));
    }, MIN_DURATION_MS);
    return () => clearTimeout(fadeTimer);
  }, [overlay]);

  useEffect(() => {
    if (!overlay || overlay.phase !== 'out') return;
    const clearTimer = setTimeout(() => setOverlay(null), LOADING_FADE_MS);
    return () => clearTimeout(clearTimer);
  }, [overlay]);

  return (
    <>
      {children}
      {overlay && (
        <LoadingScreen asset={overlay.asset} opacity={overlay.phase === 'in' ? 1 : 0} />
      )}
    </>
  );
}
