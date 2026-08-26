import React, { useEffect, useState } from 'react';

const PHRASES = [
  'Thinking',
  'Reasoning',
  'Pondering',
  'Connecting the dots',
  'Composing the answer',
  'Almost there',
];

// dotsOnly: drop the rotating phrase and the brand colour, leaving the bare
// three-dot bubble a messenger shows while the other side types. Used by
// research spaces, where naming what the model is doing is itself a cue.
const ThinkingIndicator = ({ dotsOnly = false }) => {
  const [phraseIdx, setPhraseIdx] = useState(0);

  useEffect(() => {
    if (dotsOnly) return;
    const id = setInterval(() => setPhraseIdx((i) => (i + 1) % PHRASES.length), 2200);
    return () => clearInterval(id);
  }, [dotsOnly]);

  const dotColor = dotsOnly ? 'bg-gray-400' : 'bg-[#FA6C43]';

  return (
    <div className="flex items-center gap-2 h-8">
      {!dotsOnly && (
        <span
          key={phraseIdx}
          className="thinking-shimmer text-sm font-semibold animate-in fade-in duration-500"
        >
          {PHRASES[phraseIdx]}
        </span>
      )}
      <span className="flex gap-1">
        <span
          className={`w-1.5 h-1.5 rounded-full ${dotColor} animate-bounce`}
          style={{ animationDelay: '0ms' }}
        />
        <span
          className={`w-1.5 h-1.5 rounded-full ${dotColor} animate-bounce`}
          style={{ animationDelay: '150ms' }}
        />
        <span
          className={`w-1.5 h-1.5 rounded-full ${dotColor} animate-bounce`}
          style={{ animationDelay: '300ms' }}
        />
      </span>
    </div>
  );
};

export default ThinkingIndicator;
