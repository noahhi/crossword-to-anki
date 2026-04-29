// Content script injected into NYT and New Yorker crossword pages.
//
// Two responsibilities:
//   1) Read the currently-active clue and the letters of its answer from the DOM.
//   2) Show a small overlay form that lets the user edit and confirm before
//      sending to AnkiConnect (via the popup/options storage settings).
//
// NYT renders the crossword as SVG with <text> nodes for letters. The New
// Yorker uses a similar player. We use class-name heuristics with fallbacks
// because either site may tweak markup.

(function () {
  // -------- Source detection ------------------------------------------------

  function detectSource() {
    return window.location.hostname.includes("newyorker.com") ? "newyorker" : "nyt";
  }

  // -------- DOM scraping ----------------------------------------------------

  function getActiveClueElement() {
    // NYT: highlighted clue class. New Yorker uses similar patterns.
    // Try both sets of selectors so the same code covers both sites.
    return (
      document.querySelector('[class*="xwd__clue--selected"]') ||
      document.querySelector('[class*="Clue-active"]') ||
      document.querySelector('[class*="Clue--selected"]') ||
      document.querySelector('[class*="clue--selected"]') ||
      document.querySelector('[class*="clue--active"]') ||
      document.querySelector('li[aria-selected="true"]') ||
      null
    );
  }

  function getActiveClueText() {
    const el = getActiveClueElement();
    if (!el) return null;
    // Clue items typically contain a label span (e.g. "12A") and a text span.
    // Concatenate visible text and split off the leading label.
    const raw = el.innerText.trim();
    // Remove a leading "12A" / "3D" style label if present.
    const cleaned = raw.replace(/^\s*\d+\s*[AD]?\s*[\.:\-]?\s*/i, "").trim();
    return cleaned || raw;
  }

  function getActiveDirection() {
    const el = getActiveClueElement();
    if (!el) return null;
    // The list the clue belongs to has a heading "Across" or "Down" nearby.
    const list =
      el.closest('[class*="ClueList"]') ||
      el.closest('[class*="clue-list"]') ||
      el.closest("section") ||
      el.closest("ul");
    if (!list) return null;
    const heading = list.querySelector("h3, h2, [class*='Header'], [class*='header']");
    if (!heading) return null;
    const t = heading.innerText.toLowerCase();
    if (t.includes("across")) return "across";
    if (t.includes("down")) return "down";
    return null;
  }

  function getActiveAnswerLetters() {
    // The grid uses <g> groups per cell. The active word's cells get a
    // "highlighted" class. We collect all highlighted cells in DOM order
    // and read their <text>. Both NYT and New Yorker use similar SVG patterns.
    const highlighted = document.querySelectorAll(
      '[class*="xwd__cell--highlighted"], [class*="cell--highlighted"], [class*="Cell--highlighted"], [class*="Cell-highlighted"]'
    );
    if (!highlighted.length) return null;

    const letters = [];
    highlighted.forEach((el) => {
      // The highlighted element may be a <rect>; the <text> nodes for the
      // letter live in the parent <g> cell group.
      const cell = el.tagName.toLowerCase() === "g" ? el : el.closest("g");
      if (!cell) {
        letters.push("");
        return;
      }
      const texts = cell.querySelectorAll("text");
      if (!texts.length) {
        letters.push("");
        return;
      }
      const letter = texts[texts.length - 1].textContent.trim();
      letters.push(letter || "");
    });
    return letters.join("").toUpperCase();
  }

  function parseDateString(str) {
    const m = str.match(
      /(Sun|Mon|Tues|Wednes|Thurs|Fri|Satur)day,\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/
    );
    if (!m) return null;
    const [, dayPrefix, month, day, year] = m;
    const dayMap = {
      Sun: "Sunday", Mon: "Monday", Tues: "Tuesday", Wednes: "Wednesday",
      Thurs: "Thursday", Fri: "Friday", Satur: "Saturday",
    };
    return {
      iso: new Date(`${month} ${day}, ${year}`).toISOString().slice(0, 10),
      weekday: dayMap[dayPrefix] || null,
      pretty: `${dayMap[dayPrefix]}, ${month} ${day}, ${year}`,
    };
  }

  function getPuzzleDate() {
    // Try the page title first — NYT includes the date there.
    const fromTitle = parseDateString(document.title);
    if (fromTitle) return fromTitle;

    // New Yorker: date may appear in the URL as /crossword/YYYY/MM/DD
    const urlMatch = window.location.pathname.match(/\/(\d{4})\/(\d{2})\/(\d{2})/);
    if (urlMatch) {
      const [, year, month, day] = urlMatch;
      const d = new Date(`${year}-${month}-${day}T12:00:00`);
      const weekday = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][d.getDay()];
      const monthName = d.toLocaleString("en-US", { month: "long" });
      return {
        iso: `${year}-${month}-${day}`,
        weekday,
        pretty: `${weekday}, ${monthName} ${parseInt(day, 10)}, ${year}`,
      };
    }

    // New Yorker: date may appear in a byline or header element on the page.
    const bylineEl = document.querySelector(
      '[class*="byline"], [class*="Byline"], [class*="pub-date"], time[datetime]'
    );
    if (bylineEl) {
      const dt = bylineEl.getAttribute("datetime") || bylineEl.textContent || "";
      const fromEl = parseDateString(dt);
      if (fromEl) return fromEl;
    }

    return null;
  }

  function getActiveAnswerLength() {
    const highlighted = document.querySelectorAll(
      '[class*="xwd__cell--highlighted"], [class*="cell--highlighted"]'
    );
    return highlighted.length || null;
  }

  function capture() {
    const clue = getActiveClueText();
    const answer = getActiveAnswerLetters();
    const answerLength = getActiveAnswerLength();
    const direction = getActiveDirection();
    const date = getPuzzleDate();
    const source = detectSource();
    return { clue, answer, answerLength, direction, date, source };
  }

  // -------- Overlay UI ------------------------------------------------------

  let overlayEl = null;

  function showOverlay(captured) {
    closeOverlay();

    const overlay = document.createElement("div");
    overlay.id = "cwa-overlay";
    overlay.innerHTML = `
      <div class="cwa-card">
        <div class="cwa-header">
          <span>Add to Anki</span>
          <button class="cwa-close" aria-label="Close">×</button>
        </div>
        <label>Clue
          <textarea class="cwa-clue" rows="2"></textarea>
        </label>
        <label>Answer
          <input class="cwa-answer" type="text" />
        </label>
        <label>Notes (optional)
          <textarea class="cwa-notes" rows="2" placeholder="Definition, mnemonic, why it tripped you up…"></textarea>
        </label>
        <div class="cwa-image-section" style="display:none">
          <label>Image <span class="cwa-image-hint"></span>
            <div class="cwa-image-preview"></div>
            <input class="cwa-image-url" type="text" placeholder="Paste image URL…" />
          </label>
        </div>
        <div class="cwa-history"></div>
        <div class="cwa-meta"></div>
        <div class="cwa-status"></div>
        <div class="cwa-actions">
          <button class="cwa-cancel">Cancel</button>
          <button class="cwa-save">Save to Anki</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlayEl = overlay;

    overlay.querySelector(".cwa-clue").value = captured.clue || "";
    overlay.querySelector(".cwa-answer").value = captured.answer || "";

    const metaBits = [];
    if (captured.direction) metaBits.push(captured.direction);
    if (captured.date) metaBits.push(captured.date.pretty);
    overlay.querySelector(".cwa-meta").textContent = metaBits.join(" · ");

    if (captured.answer) {
      const historyEl = overlay.querySelector(".cwa-history");
      historyEl.innerHTML = '<div class="cwa-history-loading">Loading history…</div>';
      chrome.runtime.sendMessage(
        { type: "FETCH_WORD_HISTORY", word: captured.answer },
        (resp) => renderHistory(historyEl, resp)
      );
    }

    overlay.querySelector(".cwa-close").addEventListener("click", closeOverlay);
    overlay.querySelector(".cwa-cancel").addEventListener("click", closeOverlay);
    overlay.querySelector(".cwa-save").addEventListener("click", () =>
      handleSave(captured)
    );
    overlay.querySelector(".cwa-image-url").addEventListener("change", (e) => {
      renderImagePreview(
        overlay.querySelector(".cwa-image-preview"),
        e.target.value.trim()
      );
    });

    // Focus the answer field if it's empty (likely case when capturing
    // before filling the entry); otherwise focus Save.
    const answerEl = overlay.querySelector(".cwa-answer");
    if (!answerEl.value) answerEl.focus();
    else overlay.querySelector(".cwa-save").focus();

    // Esc to close, Cmd/Ctrl+Enter to save.
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeOverlay();
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSave(captured);
    });
  }

  function renderHistory(historyEl, resp) {
    if (!historyEl) return;
    if (!resp || !resp.ok || !resp.count) {
      historyEl.innerHTML = "";
      return;
    }
    const rows = (resp.recentClues || [])
      .map(
        (e) =>
          `<tr><td class="cwa-history-date">${e.date}</td><td>${escapeHtml(e.clue)}</td></tr>`
      )
      .join("");
    historyEl.innerHTML = `
      <div class="cwa-history-count">Appeared ${resp.count} time${resp.count === 1 ? "" : "s"} in NYT crosswords</div>
      ${rows ? `<table class="cwa-history-table"><thead><tr><th>Date</th><th>Clue</th></tr></thead><tbody>${rows}</tbody></table>` : ""}
    `;
  }

  function renderImagePreview(previewEl, url) {
    if (!url) {
      previewEl.innerHTML = "";
      return;
    }
    previewEl.innerHTML = `<img class="cwa-image-thumb" src="${escapeHtml(url)}" alt="Image preview" />
      <button class="cwa-image-remove">Remove</button>`;
    previewEl.querySelector(".cwa-image-remove").addEventListener("click", () => {
      if (!overlayEl) return;
      overlayEl.querySelector(".cwa-image-url").value = "";
      previewEl.innerHTML = "";
    });
  }

  function setImagePreview(url, hintText) {
    if (!overlayEl) return;
    const hintEl = overlayEl.querySelector(".cwa-image-hint");
    if (hintEl && hintText) hintEl.textContent = hintText;
    overlayEl.querySelector(".cwa-image-url").value = url;
    renderImagePreview(overlayEl.querySelector(".cwa-image-preview"), url);
  }

  async function initImageSection(captured) {
    if (!overlayEl) return;
    const settings = await chrome.storage.sync.get(["imageField", "autoFetchImage"]);
    if (!settings.imageField) return;

    const section = overlayEl.querySelector(".cwa-image-section");
    section.style.display = "";

    if (settings.autoFetchImage && captured.answer) {
      const hintEl = overlayEl.querySelector(".cwa-image-hint");
      hintEl.textContent = "fetching…";
      chrome.runtime.sendMessage(
        { type: "FETCH_IMAGE", word: captured.answer },
        (resp) => {
          if (!overlayEl) return;
          hintEl.textContent = "";
          if (resp && resp.imageUrl) {
            setImagePreview(resp.imageUrl, "from Wikipedia");
          }
        }
      );
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function closeOverlay() {
    if (overlayEl && overlayEl.parentNode) {
      overlayEl.parentNode.removeChild(overlayEl);
    }
    overlayEl = null;
  }

  function setStatus(msg, kind) {
    if (!overlayEl) return;
    const el = overlayEl.querySelector(".cwa-status");
    el.textContent = msg;
    el.className = "cwa-status" + (kind ? " cwa-status--" + kind : "");
  }

  async function handleSave(captured) {
    if (!overlayEl) return;
    const clue = overlayEl.querySelector(".cwa-clue").value.trim();
    const answer = overlayEl.querySelector(".cwa-answer").value.trim().toUpperCase();
    const notes = overlayEl.querySelector(".cwa-notes").value.trim();

    if (!clue || !answer) {
      setStatus("Need both a clue and an answer.", "error");
      return;
    }

    const imageUrlEl = overlayEl.querySelector(".cwa-image-url");
    const imageUrl = imageUrlEl ? imageUrlEl.value.trim() || null : null;

    setStatus("Saving…");
    overlayEl.querySelector(".cwa-save").disabled = true;

    // Hand off to the background page, which has the AnkiConnect helper and
    // the saved settings. We send a plain message and await the response.
    chrome.runtime.sendMessage(
      {
        type: "SAVE_CARD",
        payload: {
          clue,
          answer,
          notes,
          imageUrl,
          answerLength: captured.answerLength,
          direction: captured.direction,
          date: captured.date,
        },
      },
      (resp) => {
        if (!overlayEl) return;
        if (chrome.runtime.lastError) {
          setStatus(chrome.runtime.lastError.message, "error");
          overlayEl.querySelector(".cwa-save").disabled = false;
          return;
        }
        if (resp && resp.ok) {
          setStatus(resp.message || "Saved.", "ok");
          setTimeout(closeOverlay, 900);
        } else {
          setStatus((resp && resp.error) || "Failed.", "error");
          overlayEl.querySelector(".cwa-save").disabled = false;
        }
      }
    );
  }

  // -------- Message wiring --------------------------------------------------

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === "CAPTURE_CLUE") {
      const captured = capture();
      showOverlay(captured);
      initImageSection(captured);
      sendResponse({ ok: true });
    }
    return true;
  });
})();
