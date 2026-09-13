// @language JavaScript (React / JSX)
// @updated   2026-09-13
// @changed   New file: the Present view — a Mentimeter-style QR + live-results screen meant for a
//            projector during class. Polls GET /studio/projects/:id/live-summary every 2.5s (no
//            Socket.IO — Studio has no realtime infra yet, and a couple seconds of lag is invisible
//            in a classroom setting); every number/bar animates to its new value via framer-motion
//            rather than snapping, per the "every touchpoint should feel alive" brief. Chart forms
//            follow the dataviz skill's job-based selection (bar for magnitude, diverging bar for
//            MaxDiff's above/below-zero score, stacked bar for Constant Sum's part-to-whole,
//            wordcloud for open text) using this app's existing validated categorical palette
//            (frontend/src/facilitator/widgets/chart/index.jsx's PALETTE) rather than inventing a
//            new one. See backend src/studio/summary.py for what's aggregated and why AI-native and
//            data-quality instruments never appear here.
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { motion, AnimatePresence, useSpring, useTransform } from 'framer-motion';
import { FaArrowLeft, FaUsers, FaSpinner } from 'react-icons/fa';
import apiClient from '../api/apiClient';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";
const POLL_MS = 2500;
const ORANGE = '#FA6C43';
const DARK = '#1F1F1F';
const PALETTE = ['#FA6C43', '#2563EB', '#16A34A', '#9333EA', '#D97706'];
const DIVERGING_POS = '#FA6C43';
const DIVERGING_NEG = '#2563EB';
const SPRING = { type: 'spring', stiffness: 90, damping: 18 };

// Pre-extracted so JSX tags are plain identifiers (<MotionDiv>) rather than
// member expressions (<motion.div>) — this project's eslint config has no
// react/JSX-aware no-unused-vars handling, which otherwise flags `motion`
// as unused despite being referenced only via JSX tag names.
const MotionDiv = motion.div;
const MotionSpan = motion.span;
const MotionP = motion.p;

// Ticks a displayed number/decimal smoothly toward `value` on every change,
// via framer-motion's MotionValue-as-children recipe — no per-tick re-render.
const AnimatedNumber = ({ value, decimals = 0, className, style }) => {
  const spring = useSpring(0, { stiffness: 120, damping: 22 });
  const display = useTransform(spring, (v) => v.toFixed(decimals));
  useEffect(() => { spring.set(value ?? 0); }, [value, spring]);
  return <MotionSpan className={className} style={style}>{display}</MotionSpan>;
};

const BarRow = ({ label, pct, sublabel, color = ORANGE }) => (
  <div className="flex items-center gap-3">
    <span
      className="w-28 shrink-0 text-sm truncate text-right"
      style={{ fontFamily: FONT_BODY, color: DARK }}
      title={label}
    >
      {label}
    </span>
    <div className="flex-1 h-6 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(31,31,31,0.06)' }}>
      <MotionDiv
        className="h-full rounded-full"
        style={{ backgroundColor: color }}
        initial={false}
        animate={{ width: `${Math.max(pct, 0)}%` }}
        transition={SPRING}
      />
    </div>
    <span
      className="w-20 shrink-0 text-xs font-semibold tabular-nums"
      style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.6)' }}
    >
      {sublabel}
    </span>
  </div>
);

const BarChart = ({ block }) => (
  <div className="flex flex-col gap-2">
    {block.type === 'semantic_differential' && (
      <div
        className="flex justify-between text-[11px] font-semibold mb-1"
        style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.45)' }}
      >
        <span>{block.left_label}</span>
        <span>{block.right_label}</span>
      </div>
    )}
    {block.data.map((d) => (
      <BarRow key={d.label} label={d.label} pct={d.pct} sublabel={`${d.count} · ${d.pct}%`} />
    ))}
  </div>
);

const DivergingBarChart = ({ data }) => {
  const maxAbs = Math.max(1, ...data.map((d) => Math.abs(d.score)));
  return (
    <div className="flex flex-col gap-2">
      {data.map((d) => {
        const pct = (Math.abs(d.score) / maxAbs) * 50;
        const positive = d.score >= 0;
        return (
          <div key={d.label} className="flex items-center gap-3">
            <span
              className="w-28 shrink-0 text-sm truncate text-right"
              style={{ fontFamily: FONT_BODY, color: DARK }}
              title={d.label}
            >
              {d.label}
            </span>
            <div
              className="flex-1 h-6 relative rounded-full overflow-hidden"
              style={{ backgroundColor: 'rgba(31,31,31,0.06)' }}
            >
              <div
                className="absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2"
                style={{ backgroundColor: 'rgba(31,31,31,0.2)' }}
              />
              <MotionDiv
                className="absolute top-0 bottom-0 rounded-full"
                style={{
                  backgroundColor: positive ? DIVERGING_POS : DIVERGING_NEG,
                  left: positive ? '50%' : undefined,
                  right: positive ? undefined : '50%',
                }}
                initial={false}
                animate={{ width: `${pct}%` }}
                transition={SPRING}
              />
            </div>
            <span
              className="w-14 shrink-0 text-xs font-semibold tabular-nums text-right"
              style={{ fontFamily: FONT_BODY, color: positive ? DIVERGING_POS : DIVERGING_NEG }}
            >
              {d.score > 0 ? `+${d.score}` : d.score}
            </span>
          </div>
        );
      })}
    </div>
  );
};

const StackedBarChart = ({ data }) => (
  <div>
    <div className="flex h-7 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(31,31,31,0.06)' }}>
      {data.map((d, i) => (
        <MotionDiv
          key={d.label}
          initial={false}
          animate={{ width: `${d.pct}%` }}
          transition={SPRING}
          style={{ backgroundColor: PALETTE[i % PALETTE.length], marginRight: i < data.length - 1 ? 2 : 0 }}
        />
      ))}
    </div>
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5">
      {data.map((d, i) => (
        <span
          key={d.label}
          className="flex items-center gap-1.5 text-xs"
          style={{ fontFamily: FONT_BODY, color: DARK }}
        >
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
          {d.label}
          <span style={{ color: 'rgba(31,31,31,0.5)' }}>({d.avg_allocation})</span>
        </span>
      ))}
    </div>
  </div>
);

const RankChart = ({ data }) => {
  const n = data.length;
  return (
    <div className="flex flex-col gap-2">
      {data.map((d, idx) => {
        const pct = d.avg_rank == null ? 0 : ((n - d.avg_rank) / Math.max(n - 1, 1)) * 100;
        return (
          <BarRow
            key={d.label}
            label={`${idx + 1}. ${d.label}`}
            pct={pct}
            sublabel={d.avg_rank != null ? `avg #${d.avg_rank}` : '—'}
          />
        );
      })}
    </div>
  );
};

const CardSortList = ({ data }) => (
  <div className="flex flex-col gap-1.5">
    {data.map((d) => (
      <MotionDiv
        key={d.item}
        layout
        className="flex items-center justify-between px-3 py-2 rounded-lg"
        style={{ backgroundColor: 'rgba(31,31,31,0.04)', fontFamily: FONT_BODY }}
      >
        <span className="text-sm truncate" style={{ color: DARK }}>{d.item}</span>
        <span className="text-xs font-semibold shrink-0 ml-2" style={{ color: ORANGE }}>
          {d.top_category ? `${d.top_category} · ${d.pct}%` : 'No answers yet'}
        </span>
      </MotionDiv>
    ))}
  </div>
);

const WordCloud = ({ data }) => {
  const words = data.words || [];
  const max = Math.max(1, ...words.map((w) => w.count));
  return (
    <div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 items-baseline mb-3 min-h-[2rem]">
        <AnimatePresence>
          {words.map((w) => (
            <MotionSpan
              key={w.word}
              layout
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 0.35 + 0.65 * (w.count / max), scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              style={{ fontFamily: FONT_BODY, fontSize: `${12 + (w.count / max) * 16}px`, color: ORANGE, fontWeight: 700 }}
            >
              {w.word}
            </MotionSpan>
          ))}
        </AnimatePresence>
        {words.length === 0 && (
          <span className="text-xs" style={{ color: 'rgba(31,31,31,0.4)', fontFamily: FONT_BODY }}>No answers yet</span>
        )}
      </div>
      {data.recent?.length > 0 && (
        <div className="flex flex-col gap-1 border-t pt-2" style={{ borderColor: 'rgba(31,31,31,0.08)' }}>
          <AnimatePresence initial={false}>
            {data.recent.slice(-4).map((r, i) => (
              <MotionP
                key={`${i}-${r.slice(0, 24)}`}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                className="text-xs italic truncate"
                style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.55)' }}
              >
                &ldquo;{r}&rdquo;
              </MotionP>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};

const InstrumentBadges = ({ instruments }) => {
  const entries = [];
  if (instruments?.confidence_slider) {
    entries.push({ label: 'Avg confidence', value: `${instruments.confidence_slider.avg}/100` });
  }
  if (instruments?.reaction_timer) {
    entries.push({ label: 'Avg response time', value: `${(instruments.reaction_timer.avg_ms / 1000).toFixed(1)}s` });
  }
  if (!entries.length) return null;
  return (
    <div className="flex gap-4 mt-3 pt-3 border-t" style={{ borderColor: 'rgba(31,31,31,0.08)' }}>
      {entries.map((e) => (
        <div key={e.label} className="text-xs" style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.5)' }}>
          {e.label}: <span className="font-bold" style={{ color: DARK }}>{e.value}</span>
        </div>
      ))}
    </div>
  );
};

const CHART_COMPONENTS = {
  bar: (block) => <BarChart block={block} />,
  diverging_bar: (block) => <DivergingBarChart data={block.data} />,
  stacked_bar: (block) => <StackedBarChart data={block.data} />,
  rank: (block) => <RankChart data={block.data} />,
  list: (block) => <CardSortList data={block.data} />,
  wordcloud: (block) => <WordCloud data={block.data} />,
};

const BlockCard = ({ block }) => (
  <MotionDiv
    layout
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.3 }}
    className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5"
    style={{ fontFamily: FONT_BODY }}
  >
    <div className="flex items-start justify-between gap-3 mb-3">
      <p className="text-base font-bold" style={{ color: DARK }}>{block.question}</p>
      <span
        className="shrink-0 text-xs font-semibold px-2 py-1 rounded-full tabular-nums"
        style={{ backgroundColor: 'rgba(31,31,31,0.06)', color: 'rgba(31,31,31,0.55)' }}
      >
        n=<AnimatedNumber value={block.n} />
      </span>
    </div>
    {block.avg != null && (
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-3xl font-extrabold" style={{ color: ORANGE }}>
          <AnimatedNumber value={block.avg} decimals={1} />
        </span>
        <span className="text-xs font-medium" style={{ color: 'rgba(31,31,31,0.5)' }}>average</span>
      </div>
    )}
    {(CHART_COMPONENTS[block.chart] || (() => null))(block)}
    <InstrumentBadges instruments={block.instruments} />
  </MotionDiv>
);

const StudioPresentPage = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef(null);

  const publicLink = `${window.location.origin}/s/${projectId}`;

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(publicLink, {
      width: 340,
      margin: 1,
      color: { dark: '#1F1F1F', light: '#FAFAF7' },
    }).then((url) => { if (!cancelled) setQrDataUrl(url); });
    return () => { cancelled = true; };
  }, [publicLink]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const { data } = await apiClient.get(`/studio/projects/${projectId}/live-summary`);
        if (!cancelled) { setSummary(data); setLoading(false); }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };
    poll();
    pollRef.current = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(pollRef.current); };
  }, [projectId]);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the link is still visible on screen to read off.
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: DARK }}>
        <FaSpinner className="animate-spin text-3xl" style={{ color: ORANGE }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: DARK, fontFamily: FONT_BODY }}>
      <div className="flex items-center justify-between px-6 py-4">
        <button
          onClick={() => navigate(`/studio/${projectId}`)}
          className="flex items-center gap-2 text-sm font-semibold transition-all active:scale-95"
          style={{ color: 'rgba(255,255,255,0.6)' }}
        >
          <FaArrowLeft /> Back to builder
        </button>
        <div className="flex items-center gap-2">
          <MotionSpan
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: '#22C55E' }}
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          />
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Live
          </span>
        </div>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row gap-6 px-6 pb-6 overflow-hidden">
        <div className="lg:w-[360px] shrink-0 flex flex-col items-center text-center gap-3">
          <h1 className="text-xl font-bold text-white">{summary?.title}</h1>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>Scan to join</p>
          <MotionDiv
            className="bg-white rounded-3xl p-4 shadow-2xl"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 120, damping: 16 }}
          >
            {qrDataUrl && <img src={qrDataUrl} alt="QR code to join this survey" width={260} height={260} />}
          </MotionDiv>
          <button
            onClick={handleCopyLink}
            className="text-sm font-mono px-3 py-1.5 rounded-lg transition-all active:scale-95"
            style={{ backgroundColor: 'rgba(255,255,255,0.08)', color: ORANGE }}
          >
            {copied ? 'Copied!' : publicLink.replace(/^https?:\/\//, '')}
          </button>

          <div className="mt-4 flex flex-col items-center">
            <div className="flex items-center gap-2 text-5xl font-extrabold text-white">
              <FaUsers size={28} style={{ color: ORANGE }} />
              <AnimatedNumber value={summary?.response_count} />
            </div>
            <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
              {summary?.response_count === 1 ? 'response' : 'responses'} so far
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto rounded-3xl p-6" style={{ backgroundColor: '#FAFAF7' }}>
          {summary?.blocks?.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm" style={{ color: 'rgba(31,31,31,0.4)' }}>
              This project has no results-eligible blocks yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              <AnimatePresence>
                {summary?.blocks?.map((block) => <BlockCard key={block.block_id} block={block} />)}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StudioPresentPage;
