// @language  JavaScript
// @updated   2026-08-19
// @changed   Added the Widgets page to the professor track, after "Create a Chat Bot".

// Every page body lives in ./pages/<id>.md and is pulled in at build time as a raw
// string. Eager so the whole guide is in the bundle — there are ~18 short files and
// lazy-loading them would mean a spinner on every sidebar click for no real saving.
const bodies = import.meta.glob('./pages/*.md', { query: '?raw', import: 'default', eager: true });

// Order here is the order in the sidebar AND the order prev/next walks, so a reader
// who keeps clicking "Next" gets a sensible run through the whole guide.
export const TRACKS = [
  {
    id: 'professor',
    label: 'For professors',
    blurb: 'Build an assistant, run an exercise, read the results.',
    icon: 'chalkboard',
    pages: [
      { id: 'prof-start', title: 'Getting started' },
      { id: 'prof-concepts', title: 'Key ideas' },
      { id: 'prof-chat-bot', title: 'Create a Chat Bot' },
      { id: 'prof-widgets', title: 'Widgets' },
      { id: 'prof-video-analysis', title: 'Create a Video Analysis' },
      { id: 'prof-experiential', title: 'Create an Experiential Lab' },
      { id: 'prof-manager-exercise', title: 'Create a Manager Exercise' },
      { id: 'prof-knowledge-base', title: 'Knowledge base & files' },
      { id: 'prof-invite', title: 'Invite your students' },
      { id: 'prof-results', title: 'Read the results' },
      { id: 'prof-manage', title: 'Manage your assistants' },
      { id: 'prof-troubleshooting', title: 'Troubleshooting' },
    ],
  },
  {
    id: 'student',
    label: 'For students',
    blurb: 'Join a class and work through whatever your professor set.',
    icon: 'student',
    pages: [
      { id: 'student-join', title: 'Join your class' },
      { id: 'student-dashboard', title: 'Your dashboard' },
      { id: 'student-exercises', title: 'Doing each exercise' },
      { id: 'student-troubleshooting', title: 'Troubleshooting' },
    ],
  },
  {
    id: 'account',
    label: 'Account basics',
    blurb: 'Registering, signing in, and passwords — the same for everyone.',
    icon: 'key',
    pages: [
      { id: 'account-register', title: 'Create your account' },
      { id: 'account-login', title: 'Sign in' },
      { id: 'account-password', title: 'Passwords' },
    ],
  },
];

// Flattened reading order — the spine for prev/next and for id lookups.
export const PAGES = TRACKS.flatMap((track) =>
  track.pages.map((page) => ({
    ...page,
    trackId: track.id,
    trackLabel: track.label,
    body: bodies[`./pages/${page.id}.md`] || '',
  }))
);

export const getPage = (id) => PAGES.find((p) => p.id === id) || null;

export const getTrack = (id) => TRACKS.find((t) => t.id === id) || null;

// Neighbours in the flat reading order, so "Next" carries a reader from the last
// professor page into the student track rather than dead-ending.
export function getNeighbours(id) {
  const i = PAGES.findIndex((p) => p.id === id);
  if (i === -1) return { prev: null, next: null };
  return { prev: PAGES[i - 1] || null, next: PAGES[i + 1] || null };
}

// Plain substring search over titles and body text. Markdown syntax is stripped from
// the snippet so a hit doesn't render as "## **Publish**", and the matched term is
// returned with its surrounding sentence for context.
export function searchPages(query) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const results = [];
  for (const page of PAGES) {
    const inTitle = page.title.toLowerCase().includes(q);
    const idx = page.body.toLowerCase().indexOf(q);
    if (!inTitle && idx === -1) continue;
    let snippet = '';
    if (idx !== -1) {
      const plain = page.body
        .slice(Math.max(0, idx - 60), idx + 120)
        .replace(/[#*`>|_]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      snippet = (idx > 60 ? '…' : '') + plain + '…';
    }
    // Title hits outrank body hits so typing "passwords" lands on the Passwords page.
    results.push({ ...page, snippet, rank: inTitle ? 0 : 1 });
  }
  return results.sort((a, b) => a.rank - b.rank).slice(0, 12);
}
