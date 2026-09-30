// @language  JavaScript
// @updated   2026-09-30
// @changed   New file: the video report's overall score = plain average of every criterion.

// Mirrors backend/src/video/overall.py:criteria_average so the report and the
// compare view show the same number the dashboards and exports do: the mean of
// every scored criterion (delivery dimensions, content checks, opening gambit)
// on the 0-100 scale, falling back to the stored `overall` when there are none.
export const criteriaAverage = (scores) => {
  if (!scores) return null;
  const values = [...(scores.dimensions || []), ...(scores.content_checks || [])]
    .map((c) => c?.score)
    .filter((v) => v != null);
  if (!values.length) return scores.overall ?? null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
};
