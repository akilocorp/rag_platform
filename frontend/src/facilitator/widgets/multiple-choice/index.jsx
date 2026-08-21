/**
 * @language  JavaScript (React / JSX)
 * @updated   2026-08-10
 * @changed   Grade the pick against the new `answer` key and report the question back through onSubmit's
 *            meta argument, so the bot no longer receives a context-free option string.
 */
import React from 'react';

// multiple_choice — renders a single-select question as clickable option pills.
// data shape (from the backend widget contract): { question, options: [str], answer?, explanation? }
// Clicking an option calls onSubmit(optionText, meta); the text becomes the user's
// next message and `meta` tells the backend which question it answered.
function Renderer({ data, onSubmit, disabled }) {
  // The option the user committed to. Kept locally so the pill can show the
  // verdict after the click — the message itself has already been sent.
  const [picked, setPicked] = React.useState(null);

  const options = Array.isArray(data?.options) ? data.options : [];
  if (!data?.question || options.length === 0) return null;

  // `answer` is optional: preference / next-step questions have no right answer,
  // and those must render as plain choices with no grading at all.
  const answer = typeof data.answer === 'string' ? data.answer : null;

  const choose = (opt) => {
    setPicked(opt);
    onSubmit?.(opt, {
      widget: 'multiple_choice',
      question: data.question,
      selected: opt,
      ...(answer ? { correct: answer } : {}),
    });
  };

  // Once answered, a graded question colours the chosen option and reveals the
  // correct one; ungraded questions just mark the selection.
  const pillClass = (opt) => {
    if (disabled && !picked) return 'bg-white text-gray-400 border-gray-200 cursor-not-allowed';
    if (picked) {
      if (answer && opt === answer) return 'bg-green-50 text-green-700 border-green-300';
      if (opt === picked) {
        return answer
          ? 'bg-red-50 text-red-700 border-red-300'
          : 'bg-gray-100 text-gray-700 border-gray-300';
      }
      return 'bg-white text-gray-400 border-gray-200';
    }
    return 'bg-white text-gray-700 border-gray-200 hover:border-[#FA6C43] hover:text-[#FA6C43]';
  };

  return (
    <div className="mt-2 rounded-xl border border-gray-200 bg-[#F0F6FB] p-3">
      {data.explanation && (
        <p className="text-xs text-gray-500 mb-1.5">{data.explanation}</p>
      )}
      <p className="text-sm font-semibold text-[#222] mb-2">{data.question}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((opt, i) => (
          <button
            key={i}
            type="button"
            disabled={disabled || !!picked}
            onClick={() => choose(opt)}
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${pillClass(opt)}`}
          >
            {opt}
          </button>
        ))}
      </div>
      {picked && answer && (
        <p className={`text-xs mt-2 font-semibold ${picked === answer ? 'text-green-700' : 'text-red-700'}`}>
          {picked === answer ? 'Correct' : `Not quite — the answer is "${answer}"`}
        </p>
      )}
    </div>
  );
}

export default {
  id: 'multiple_choice',
  label: 'Multiple choice',
  interactive: true,
  Renderer,
};
