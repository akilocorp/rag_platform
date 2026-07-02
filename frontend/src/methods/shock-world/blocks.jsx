import React from 'react';
import { renderMarkdown } from '../../utils/markdown';

// Shared presentational pieces for the Shock World feed, used by both the live
// Player and the read-only Replay so a professor sees the run exactly as the
// student did. Pure display — no state, no controls.

export function Card({ children, accent = false, className = '' }) {
  return (
    <div className={`rounded-2xl border bg-white shadow-sm ${accent ? 'border-[#FA6C43]/40' : 'border-gray-200'} ${className}`}>
      {children}
    </div>
  );
}

export function Dot({ d = 0 }) {
  return <span className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: `${d}ms` }} />;
}

// A feed block: the scenario intro, a posed question, a student's answer, or a
// tutor reply. Kept as plain data so the transcript can be persisted verbatim
// and replayed later.
export function FeedBlock({ block }) {
  if (block.type === 'scenario') {
    return (
      <Card accent className="p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#FA6C43] mb-1.5">Shock world</div>
        <div className="text-sm text-gray-800 leading-relaxed" dangerouslySetInnerHTML={{ __html: renderMarkdown(block.text || '') }} />
      </Card>
    );
  }
  if (block.type === 'question') {
    return (
      <Card className="p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">{block.gate ? 'Warm-up' : `Round ${block.round}`}</div>
        <div className="text-sm font-semibold text-gray-800">{block.text}</div>
      </Card>
    );
  }
  if (block.type === 'student') {
    return (
      <div className="rounded-xl border border-[#FA6C43]/40 bg-[#FA6C43]/[0.07] px-3.5 py-2.5">
        <div className="text-[10px] font-bold uppercase tracking-wide text-[#FA6C43] mb-1">You</div>
        {block.pick && <div className="text-sm font-semibold text-gray-800 mb-0.5">{block.pick}</div>}
        {block.why && <div className="text-sm text-gray-700 leading-relaxed">{block.why}</div>}
      </div>
    );
  }
  // tutor
  return (
    <Card className="p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[#FA6C43] mb-1.5">Tutor</div>
      {block.text
        ? <div className="text-sm text-gray-800 leading-relaxed prose-sm" dangerouslySetInnerHTML={{ __html: renderMarkdown(block.text) }} />
        : <div className="flex gap-1 py-1"><Dot /><Dot d={150} /><Dot d={300} /></div>}
    </Card>
  );
}
