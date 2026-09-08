// @language JavaScript
// @updated   2026-09-08
// @changed   New file: shared caller for the 3 Tier-3 live AI instruments (Comprehension Check, AI
//            Devil's-Advocate, Adaptive Follow-Up) — one thin wrapper around the public
//            /ai-instrument endpoint so each instrument's RespondExtra doesn't hand-roll its own
//            apiClient call. Throws on failure/rate-limit; callers show their own inline error.
import apiClient from '../../api/apiClient';

export async function callLiveAiInstrument(projectId, blockId, instrumentType, input) {
  const { data } = await apiClient.post(`/studio/public/projects/${projectId}/ai-instrument`, {
    block_id: blockId,
    instrument_type: instrumentType,
    input,
  });
  return data.result;
}
