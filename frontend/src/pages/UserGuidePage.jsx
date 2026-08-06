/**
 * @language  JavaScript (React / JSX)
 * @updated   2026-08-03
 * @changed   New file: the /userguide route — track landing, page render, in-guide 404.
 */
import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { FaChalkboardTeacher, FaUserGraduate, FaKey, FaArrowRight } from 'react-icons/fa';
import GuideLayout from '../guide/GuideLayout';
import GuideMarkdown from '../guide/GuideMarkdown';
import { TRACKS, getPage } from '../guide/content';

const TRACK_ICONS = {
  chalkboard: FaChalkboardTeacher,
  student: FaUserGraduate,
  key: FaKey,
};

// Bare /userguide: pick a track. Deliberately the only screen with no sidebar selection,
// so a first-time visitor answers "who am I?" before facing a 18-item nav.
function Landing() {
  return (
    <>
      <p className="text-xs font-bold uppercase tracking-wider text-[#FA6C43] mb-2">User guide</p>
      <h1 className="text-3xl font-extrabold text-[#222] mb-3">How can we help?</h1>
      <p className="text-gray-600 mb-8 max-w-2xl">
        Step-by-step walkthroughs for everything on the platform — creating an assistant,
        running the four exercises, joining a class, and sorting out account trouble.
        Pick the track that matches you.
      </p>

      <div className="space-y-4">
        {TRACKS.map((track) => {
          const Icon = TRACK_ICONS[track.icon] || FaChalkboardTeacher;
          const first = track.pages[0];
          return (
            <Link
              key={track.id}
              to={`/userguide/${first.id}`}
              className="group flex items-start gap-4 border border-gray-200 rounded-2xl p-5 hover:border-[#FA6C43] hover:bg-orange-50/40 transition-colors"
            >
              <span className="shrink-0 w-11 h-11 rounded-xl bg-[#FA6C43]/10 flex items-center justify-center">
                <Icon className="text-[#FA6C43] text-lg" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-bold text-[#222] group-hover:text-[#FA6C43] transition-colors">
                  {track.label}
                </span>
                <span className="block text-sm text-gray-500 mt-0.5">{track.blurb}</span>
                <span className="block text-xs text-gray-400 mt-2">
                  {track.pages.length} pages · starts with “{first.title}”
                </span>
              </span>
              <FaArrowRight className="text-gray-300 group-hover:text-[#FA6C43] mt-4 shrink-0 transition-colors" />
            </Link>
          );
        })}
      </div>
    </>
  );
}

// A mistyped or retired page id stays inside the guide rather than falling through to the
// app-wide 404 — the reader keeps the sidebar and can carry on from where they meant to be.
function PageMissing({ pageId }) {
  return (
    <>
      <h1 className="text-2xl font-extrabold text-[#222] mb-3">That page doesn’t exist</h1>
      <p className="text-gray-600 mb-6">
        There’s no guide page called <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm">{pageId}</code>.
        It may have been renamed. Try the search box above, or start from the top.
      </p>
      <Link to="/userguide" className="inline-block bg-[#FA6C43] text-white px-5 py-2.5 rounded-xl font-bold text-sm">
        Back to the guide
      </Link>
    </>
  );
}

export default function UserGuidePage() {
  const { pageId } = useParams();
  const page = pageId ? getPage(pageId) : null;

  return (
    <GuideLayout currentId={page ? page.id : null}>
      {!pageId && <Landing />}
      {pageId && !page && <PageMissing pageId={pageId} />}
      {page && (
        <>
          <p className="text-xs font-bold uppercase tracking-wider text-[#FA6C43] mb-2">{page.trackLabel}</p>
          <GuideMarkdown source={page.body} />
        </>
      )}
    </GuideLayout>
  );
}
