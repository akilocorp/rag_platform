import React from 'react';
import { FiAward } from 'react-icons/fi';
import { Card, FeedBlock } from './blocks.jsx';

// Read-only replay of a saved Shock World run — the professor sees the whole
// play-by-play (scenario → warm-up → each round's question, the student's pick +
// "why", and the tutor's Socratic reactions) exactly as it happened. Mounted by
// the session viewer via the method descriptor's `Replay`, so this stays inside
// the shock-world island. The score breakdown is shown by the separate Report tab.
export default function Replay({ config, transcript }) {
  // Shock World persists the transcript as the raw feed array; tolerate the
  // predict-reveal-style { feed } wrapper too, just in case.
  const feed = Array.isArray(transcript)
    ? transcript
    : (Array.isArray(transcript?.feed) ? transcript.feed : []);

  if (!feed.length) {
    return <p className="text-sm text-gray-500">No transcript was recorded for this session.</p>;
  }

  const country = config?._country || config?._grounding?.country;

  return (
    <div className="space-y-4">
      {country && (
        <Card className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Shock World</div>
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <FiAward className="text-[#FA6C43]" /> Grounded to <span className="font-semibold">{country}</span>
          </div>
        </Card>
      )}
      {feed.map((b, i) => <FeedBlock key={i} block={b} />)}
    </div>
  );
}
