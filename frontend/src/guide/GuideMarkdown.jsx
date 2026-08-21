/**
 * @language  JavaScript (React / JSX)
 * @updated   2026-08-19
 * @changed   Added mountWidgets: `<div data-guide-widget="...">` placeholders in a page's
 *            markdown now mount a live, playable FacilitatorBlock instance instead of a
 *            static screenshot.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Marked } from 'marked';
import { createRoot } from 'react-dom/client';
import FacilitatorBlock from '../facilitator/FacilitatorBlock';
import { WIDGET_DEMOS } from './widgetDemos';

// A private Marked instance. The shared `marked` singleton is configured app-wide with
// `breaks: true` for chat (utils/markdown.js), which would turn every wrapped line of
// guide prose into a <br>. Constructing our own leaves that global untouched.
const guideMarked = new Marked({ gfm: true, breaks: false });

// Screenshots are dropped into public/guide-media/ by hand, so a page can reference one
// that doesn't exist yet. Rather than a broken-image icon, swap in a dashed slot showing
// the expected filename — the guide then doubles as a live capture checklist.
function toPendingSlot(img) {
  const slot = document.createElement('div');
  slot.className = 'guide-shot__pending';
  const file = (img.getAttribute('src') || '').split('/').pop();
  slot.innerHTML =
    `<span class="guide-shot__pending-label">Screenshot pending</span>` +
    `<code class="guide-shot__pending-file"></code>`;
  slot.querySelector('.guide-shot__pending-file').textContent = file;
  img.replaceWith(slot);
}

// Wraps each <img> in a figure with the alt text as a visible caption. Done after render
// rather than via a marked renderer override so this stays independent of which token
// signature the installed marked version hands to renderer.image().
function decorateScreenshots(root) {
  root.querySelectorAll('img').forEach((img) => {
    if (img.closest('figure.guide-shot')) return;
    const caption = img.getAttribute('alt') || '';
    const figure = document.createElement('figure');
    figure.className = 'guide-shot';
    img.replaceWith(figure);
    figure.appendChild(img);
    img.loading = 'lazy';
    if (caption) {
      const cap = document.createElement('figcaption');
      cap.textContent = caption;
      figure.appendChild(cap);
    }
    // `complete && !naturalWidth` catches images that already failed before this ran
    // (cached 404s never fire a fresh error event).
    if (img.complete && !img.naturalWidth) toPendingSlot(img);
    else img.addEventListener('error', () => toPendingSlot(img), { once: true });
  });
}

// A page writes `<div data-guide-widget="chart"></div>` where it wants a live widget.
// This mounts the same FacilitatorBlock/Renderer the chat uses, fed canned demo data —
// so a reader can actually play with it, with no backend and no onSubmit behind it.
// Unknown ids (a typo, or a widget not in WIDGET_DEMOS yet) are left as empty divs rather
// than throwing, matching the "unknown widget renders nothing" contract in FacilitatorBlock.
function mountWidgets(root, rootsRef) {
  root.querySelectorAll('[data-guide-widget]').forEach((el) => {
    const id = el.getAttribute('data-guide-widget');
    const demo = WIDGET_DEMOS[id];
    if (!demo) return;
    const wrap = document.createElement('div');
    wrap.className = 'guide-widget';
    const label = document.createElement('div');
    label.className = 'guide-widget__label';
    label.textContent = 'Try it — live widget, nothing is sent anywhere';
    const mountPoint = document.createElement('div');
    wrap.appendChild(label);
    wrap.appendChild(mountPoint);
    el.replaceWith(wrap);
    const widgetRoot = createRoot(mountPoint);
    widgetRoot.render(<FacilitatorBlock block={{ widget: id, data: demo }} />);
    rootsRef.current.push(widgetRoot);
  });
}

// Slug for a heading, so other parts of the app can deep-link into a section — the
// student dashboard points each class type at its own heading here. Numbered headings
// ("## 2. Submitting a video") drop the number so the anchor stays stable if the
// sections are ever reordered.
export function slugifyHeading(text) {
  return (text || '')
    .trim()
    .replace(/^\d+[.)]\s*/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Same post-render pass as decorateScreenshots, and for the same reason: it doesn't
// depend on which token signature the installed marked version hands to a renderer.
function addHeadingIds(root) {
  root.querySelectorAll('h1, h2, h3, h4').forEach((h) => {
    if (!h.id) h.id = slugifyHeading(h.textContent);
  });
}

export default function GuideMarkdown({ source }) {
  const ref = useRef(null);
  const widgetRootsRef = useRef([]);
  const navigate = useNavigate();

  const html = useMemo(() => guideMarked.parse(source || ''), [source]);

  useEffect(() => {
    if (!ref.current) return;
    decorateScreenshots(ref.current);
    addHeadingIds(ref.current);
    mountWidgets(ref.current, widgetRootsRef);
    // dangerouslySetInnerHTML already replaced the DOM this effect mounted into by the
    // time `html` next changes (page nav), so these roots are unmounting detached nodes —
    // that's fine, it's just React state/listener teardown, not a DOM operation.
    return () => {
      widgetRootsRef.current.forEach((r) => r.unmount());
      widgetRootsRef.current = [];
    };
  }, [html]);

  // The body is injected HTML, so in-guide links are plain <a> tags that would trigger a
  // full page reload. Intercept same-origin clicks and hand them to the router instead;
  // external links fall through and open in a new tab (set below in the same pass).
  const onClick = (e) => {
    const anchor = e.target.closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    if (href.startsWith('/')) {
      e.preventDefault();
      navigate(href);
    } else if (/^https?:\/\//.test(href)) {
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
    }
  };

  return (
    <div
      ref={ref}
      className="guide-md"
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
