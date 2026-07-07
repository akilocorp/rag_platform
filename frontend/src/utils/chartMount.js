// Mount inline chat charts as the canonical interactive chart widget.
//
// renderMarkdown (utils/markdown.js) turns a ```chart fenced block into a
// placeholder <div class="chart-embed" data-chart="<base64 widget data>">.
// Because the canonical chart is a live React widget (hover crosshair + value
// tooltip, click-to-expand) it can't ride along in innerHTML — ChatPage calls
// mountCharts(el) after setting innerHTML to render the widget into each
// placeholder. This is the same pattern mountDesmosGraphs uses for graphs, and
// it means every chart in the app flows through the one canonical renderer.

import React from 'react';
import { createRoot } from 'react-dom/client';
import chartWidget from '../facilitator/widgets/chart/index.jsx';

const { Renderer } = chartWidget;

function decodeData(encoded) {
  try {
    return JSON.parse(decodeURIComponent(escape(atob(encoded))));
  } catch {
    return null;
  }
}

// Find every unmounted .chart-embed placeholder inside `el` and render the
// canonical chart widget into it. Idempotent: a data-mounted flag stops
// double-mounting when the message re-renders.
export function mountCharts(el) {
  if (!el) return;
  const nodes = el.querySelectorAll('.chart-embed:not([data-mounted])');
  if (!nodes.length) return;

  nodes.forEach((node) => {
    if (node.getAttribute('data-mounted')) return;
    const data = decodeData(node.getAttribute('data-chart') || '');
    if (!data) return;
    node.setAttribute('data-mounted', '1');
    try {
      createRoot(node).render(React.createElement(Renderer, { data }));
    } catch {
      // A render failure shouldn't blank the whole message — leave the
      // placeholder empty and move on.
    }
  });
}
