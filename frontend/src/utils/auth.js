/**
 * @language  JavaScript
 * @updated   2026-10-02
 * @changed   dashboardPath() returns '/' when logged out instead of defaulting to the professor dashboard.
 */
// Auth helpers: where a logged-in user should land, and "remember me" handling.

export function isLoggedIn() {
  return !!localStorage.getItem('jwtToken');
}

// Main landing page for a logged-in user, by role. This is where login lands people.
// Logged out there is no dashboard, so return the public home page — the old 'professor'
// default sent anonymous students (Qualtrics, public links) to /config_list → /login.
// Pages that can run logged out should hide their "back home" control instead (isLoggedIn()).
export function dashboardPath() {
  if (!isLoggedIn()) return '/';
  const role = localStorage.getItem('userRole') || 'professor';
  return role === 'student' ? '/student-dashboard' : '/config_list';
}

// Records the login persistence choice. remember=true keeps the user logged in
// across browser restarts (up to the 30-day refresh token); remember=false makes
// the session last only until the browser is closed.
export function setRememberMe(remember) {
  localStorage.setItem('rememberMe', remember ? 'true' : 'false');
  sessionStorage.setItem('authSession', '1');
}

export function clearRememberMe() {
  localStorage.removeItem('rememberMe');
  sessionStorage.removeItem('authSession');
}

// Run once on app boot. If the last login opted out of "remember me" and this is a
// fresh browser session (no per-session marker), clear the stored tokens so the user
// starts logged out. Missing flag is treated as remembered so existing sessions are
// never surprise-logged-out.
export function enforceSessionPersistence() {
  const remembered = localStorage.getItem('rememberMe') !== 'false';
  if (!remembered && isLoggedIn() && !sessionStorage.getItem('authSession')) {
    localStorage.removeItem('jwtToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('userRole');
    localStorage.removeItem('isVerified');
  }
  sessionStorage.setItem('authSession', '1');
}
