// MintHunter dashboard — fetches data.json written by agent/run.js and renders it.
// No external dependencies. A missing data.json is a normal state (agent has not
// run yet), so it is handled gracefully without logging a console error.

(function () {
  "use strict";

  var DATA_URL = "data.json";

  var CHAIN_NAMES = {
    1: "Ethereum",
    56: "BNB Smart Chain",
    97: "BNB Testnet",
    137: "Polygon",
    8453: "Base",
    42161: "Arbitrum One"
  };

  function chainLabel(chainId) {
    if (typeof chainId !== "number") return "Unknown chain";
    return CHAIN_NAMES[chainId] || ("Chain " + chainId);
  }

  // Escape text from data.json before inserting it into the page.
  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Truncate a long hex string (address / tx hash) for display, keeping the
  // full value available on hover.
  function truncateHex(value) {
    if (typeof value !== "string" || value.length <= 14) return value || "";
    return value.slice(0, 6) + "..." + value.slice(-4);
  }

  function formatTimestamp(isoString) {
    if (!isoString) return "—";
    var date = new Date(isoString);
    if (isNaN(date.getTime())) return String(isoString);
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  }

  function setStatus(state, text) {
    var dot = document.getElementById("statusDot");
    var label = document.getElementById("statusText");
    if (dot) dot.className = "status-dot status-dot--" + state;
    if (label) label.textContent = text;
  }

  function showEmptyState() {
    var empty = document.getElementById("emptyState");
    if (empty) empty.hidden = false;
    setStatus("idle", "No data yet");
  }

  function renderHunt(hunt) {
    var verdict = hunt.verdict === "SAFE" ? "SAFE" : "UNSAFE";
    var verdictClass = verdict === "SAFE" ? "safe" : "unsafe";
    var name = hunt.name || "Unnamed contract";
    var contract = hunt.contract || "";
    var reasons = Array.isArray(hunt.reasons) ? hunt.reasons : [];

    var reasonsHtml = reasons.length
      ? '<ul class="hunt-reasons">' +
          reasons.map(function (reason) {
            return "<li>" + escapeHtml(reason) + "</li>";
          }).join("") +
        "</ul>"
      : '<p class="hunt-not-minted">No reasons recorded.</p>';

    var txHtml;
    if (hunt.txHash) {
      var txLabel = truncateHex(hunt.txHash);
      var txLink = hunt.explorerUrl
        ? '<a href="' + escapeHtml(hunt.explorerUrl) + '" target="_blank" rel="noopener noreferrer" title="' + escapeHtml(hunt.txHash) + '">' + escapeHtml(txLabel) + "</a>"
        : '<span class="mono" title="' + escapeHtml(hunt.txHash) + '">' + escapeHtml(txLabel) + "</span>";
      txHtml = '<p class="hunt-tx"><span class="label">Minted &mdash; tx:</span> ' + txLink + "</p>";
    } else {
      txHtml = '<p class="hunt-not-minted">Not minted.</p>';
    }

    return (
      '<article class="hunt-card hunt-card--' + verdictClass + '">' +
        '<div class="hunt-head">' +
          '<h3 class="hunt-name">' + escapeHtml(name) + "</h3>" +
          '<span class="badge badge--' + verdictClass + '">' + verdict + "</span>" +
        "</div>" +
        '<div class="hunt-meta">' +
          '<span><span class="label">Contract:</span> ' +
            '<span class="hunt-address" title="' + escapeHtml(contract) + '">' + escapeHtml(truncateHex(contract)) + "</span></span>" +
          '<span><span class="label">Chain:</span> ' + escapeHtml(chainLabel(hunt.chainId)) +
            (typeof hunt.chainId === "number" ? " (" + hunt.chainId + ")" : "") + "</span>" +
        "</div>" +
        reasonsHtml +
        txHtml +
      "</article>"
    );
  }

  function render(data) {
    var hunts = Array.isArray(data.hunts) ? data.hunts : [];

    // Agent identity.
    document.getElementById("nearAccountId").textContent =
      data.nearAccountId || "—";
    document.getElementById("derivedEvmAddress").textContent =
      data.derivedEvmAddress || "—";
    document.getElementById("identityCard").hidden = false;

    // Summary counts.
    var safeCount = hunts.filter(function (h) { return h.verdict === "SAFE"; }).length;
    var unsafeCount = hunts.filter(function (h) { return h.verdict !== "SAFE"; }).length;
    var mintedCount = hunts.filter(function (h) { return !!h.txHash; }).length;
    document.getElementById("statTotal").textContent = String(hunts.length);
    document.getElementById("statSafe").textContent = String(safeCount);
    document.getElementById("statUnsafe").textContent = String(unsafeCount);
    document.getElementById("statMinted").textContent = String(mintedCount);
    document.getElementById("statsBar").hidden = false;

    // Hunt feed.
    var feed = document.getElementById("huntFeed");
    feed.innerHTML = hunts.length
      ? hunts.map(renderHunt).join("")
      : '<p class="hunt-not-minted">No hunts recorded yet.</p>';
    document.getElementById("huntFeedSection").hidden = false;

    // Last updated.
    document.getElementById("lastUpdated").textContent =
      formatTimestamp(data.generatedAt);

    setStatus("live", hunts.length + (hunts.length === 1 ? " hunt" : " hunts"));
  }

  function load() {
    // Cache-bust so a judge refreshing after a new agent run sees fresh data.
    fetch(DATA_URL + "?t=" + Date.now(), { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) throw new Error("data.json not available (HTTP " + response.status + ")");
        return response.json();
      })
      .then(function (data) {
        if (!data || typeof data !== "object") throw new Error("data.json is not valid JSON");
        render(data);
      })
      .catch(function () {
        // Missing or invalid data.json: expected before the first agent run.
        // Show the friendly message and nothing else — no console error.
        showEmptyState();
        document.getElementById("lastUpdated").textContent = "—";
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else {
    load();
  }
})();
