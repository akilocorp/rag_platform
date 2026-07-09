/**
 * RAG Platform — Qualtrics parent-page snippet.
 *
 * This file is the source of truth. It is never loaded by <script src="...">
 * inside a Qualtrics question (Qualtrics strips external <script src> tags in
 * some themes) — instead the "Get Embed Code" button on the Edit Assistant
 * page fetches this file, substitutes __CONFIG_ID__ / __EMBED_ORIGIN__, and
 * inlines the result into the copy-paste HTML block together with the
 * <iframe>. Paste that whole block into a Text/Graphic question's HTML view.
 * No "Advanced JavaScript" option needed — the <script> tag runs as part of
 * the question's own HTML.
 *
 * What it does:
 *  - Listens for postMessage events from the chat iframe (CHAT_MESSAGE / SAVE_RAG_CHAT).
 *  - Writes the running transcript + status to Qualtrics Embedded Data fields:
 *      transcript   — formatted chat transcript, updated after every message
 *      chat_status  — "started" -> "in_progress" -> "completed"
 *  - "condition" is intentionally NOT written here. If your survey uses
 *    conditions/branching, declare "condition" in Survey Flow yourself
 *    (randomizer, branch logic, etc.) — this widget just needs it to exist
 *    so it's included in the export alongside transcript/chat_status.
 */
(function () {
  var RAG_CONFIG_ID = "__CONFIG_ID__";
  var RAG_ALLOWED_ORIGIN = "__EMBED_ORIGIN__";

  if (typeof Qualtrics === "undefined" || !Qualtrics.SurveyEngine) {
    console.warn("[RAG] Qualtrics.SurveyEngine not available — embed snippet not active.");
    return;
  }

  window.ragChatHistory = window.ragChatHistory || [];
  window.ragChatConfig = window.ragChatConfig || {
    configId: RAG_CONFIG_ID,
    responseId: "${e://Field/ResponseID}",
    initialized: true
  };

  function formatTranscript() {
    return window.ragChatHistory
      .map(function (msg) {
        var who = msg.sender === "user" ? "User" : "AI Assistant";
        return "[" + msg.timestamp + "] " + who + ": " + msg.content;
      })
      .join("\n");
  }

  function saveProgress() {
    try {
      Qualtrics.SurveyEngine.setEmbeddedData("transcript", formatTranscript());
      Qualtrics.SurveyEngine.setEmbeddedData(
        "chat_status",
        window.ragChatHistory.length > 0 ? "in_progress" : "started"
      );
    } catch (err) {
      console.error("[RAG] Failed to write embedded data:", err);
    }
  }

  Qualtrics.SurveyEngine.setEmbeddedData("chat_status", "started");

  window.addEventListener("message", function (event) {
    if (event.origin !== RAG_ALLOWED_ORIGIN) return;
    var data = event.data || {};

    if (data.type === "CHAT_MESSAGE") {
      window.ragChatHistory.push({
        sender: data.sender,
        content: data.content,
        timestamp: data.timestamp || new Date().toISOString()
      });
      saveProgress();
    }

    if (data.type === "SAVE_RAG_CHAT") {
      saveProgress();
    }
  });

  Qualtrics.SurveyEngine.addOnPageSubmit(function () {
    saveProgress();
    Qualtrics.SurveyEngine.setEmbeddedData("chat_status", "completed");
  });

  // Safety net: addOnPageSubmit doesn't fire on tab close / hard navigation.
  window.addEventListener("pagehide", saveProgress);
})();
