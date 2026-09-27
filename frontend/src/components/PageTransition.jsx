// @language  JavaScript (React / JSX)
// @updated   2026-09-27
// @changed   Route changes no longer play the full-screen loader. It was held for >=1.1s (+260ms fade)
//            on every navigation, but no route is lazy-loaded — pages render the instant the URL
//            changes — so it was pure delay. Real waits (auth guards, data fetches) still render
//            LoadingScreen themselves. Kept as a passthrough so App's tree and any future
//            route-level hook have one place to live.
import React from 'react';

// Route-change wrapper. Currently a passthrough: every page is in the main bundle, so there
// is never a render gap to cover. If routes become React.lazy, wrap them in Suspense with a
// delayed LoadingScreen fallback here rather than reinstating a fixed-duration overlay.
export default function PageTransition({ children }) {
  return <>{children}</>;
}
