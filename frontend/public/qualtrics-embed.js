/**
 * ACTRLabs hosted Qualtrics bridge.
 *
 * The Qualtrics question JavaScript sets window.ACTRLabsQualtrics and loads
 * this file. Keeping the implementation here lets ACTRLabs ship fixes without
 * asking researchers to replace the full integration in every survey.
 */
(function () {
  "use strict";

  var config = window.ACTRLabsQualtrics || {};
  var allowedOrigin = String(config.embedOrigin || "").replace(/\/$/, "");
  if (!allowedOrigin || typeof Qualtrics === "undefined" || !Qualtrics.SurveyEngine) {
    console.warn("[ACTRLabs] Qualtrics bridge is missing its configuration.");
    return;
  }

  // Loading twice must not duplicate transcript rows or event listeners.
  if (window.__actrLabsQualtricsBridgeLoaded) return;
  window.__actrLabsQualtricsBridgeLoaded = true;

  var messages = [];

  function formatTranscript() {
    return messages.map(function (message) {
      var who = message.sender === "user" ? "User" : "AI Assistant";
      return "[" + message.timestamp + "] " + who + ": " + message.content;
    }).join("\n");
  }

  function save(status) {
    try {
      Qualtrics.SurveyEngine.setEmbeddedData("transcript", formatTranscript());
      Qualtrics.SurveyEngine.setEmbeddedData(
        "chat_status",
        status || (messages.length ? "in_progress" : "started")
      );
    } catch (error) {
      console.error("[ACTRLabs] Could not save Qualtrics embedded data:", error);
    }
  }

  function receive(event) {
    if (event.origin !== allowedOrigin) return;
    var data = event.data || {};
    if (data.type !== "CHAT_MESSAGE") return;
    messages.push({
      sender: data.sender,
      content: data.content || "",
      timestamp: data.timestamp || new Date().toISOString()
    });
    save("in_progress");
  }

  window.addEventListener("message", receive);
  save("started");

  Qualtrics.SurveyEngine.addOnPageSubmit(function () {
    save("completed");
  });

  window.addEventListener("pagehide", function () { save(); });
})();
