import React, { useState } from 'react';

// flashcard — a display-only deck of active-recall flip cards.
// data shape (from the backend widget contract): { title?, cards: [{ front, back }] }
// Click a card to flip front↔back; non-interactive (nothing is sent back).
function Card({ front, back }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setFlipped((f) => !f)}
      className="fac-flip group relative h-28 w-full text-left"
      aria-label={flipped ? 'Show front' : 'Show answer'}
    >
      <div className={`fac-flip-inner ${flipped ? 'is-flipped' : ''}`}>
        {/* front — the cue */}
        <div className="fac-flip-face rounded-xl border border-gray-200 bg-white p-3 shadow-sm transition-colors group-hover:border-[#FA6C43]">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Term</span>
          <p className="mt-1 text-sm font-semibold text-[#222] line-clamp-3">{front}</p>
          <span className="absolute bottom-2 right-3 text-[10px] font-medium text-gray-300 transition-colors group-hover:text-[#FA6C43]">Tap to flip</span>
        </div>
        {/* back — the recall target */}
        <div className="fac-flip-face fac-flip-back rounded-xl border border-[#FA6C43]/40 bg-[#FFF3EF] p-3 shadow-sm">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[#FA6C43]">Answer</span>
          <p className="mt-1 text-sm font-medium text-[#7a2e18] line-clamp-3">{back}</p>
        </div>
      </div>
    </button>
  );
}

function Renderer({ data }) {
  const cards = Array.isArray(data?.cards) ? data.cards : [];
  if (cards.length === 0) return null;

  return (
    <div className="mt-2 rounded-xl border border-gray-200 bg-[#F0F6FB] p-3">
      {data.title && (
        <p className="mb-2 text-sm font-semibold text-[#222]">{data.title}</p>
      )}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {cards.map((c, i) => (
          <Card key={i} front={c.front} back={c.back} />
        ))}
      </div>
    </div>
  );
}

export default {
  id: 'flashcard',
  label: 'Flashcards',
  interactive: false,
  Renderer,
};
