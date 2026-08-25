// Content script injected into NYT, New Yorker and PuzzleMe (Vox) crossword pages.
//
// Two responsibilities:
//   1) Read the currently-active clue and the letters of its answer from the DOM.
//   2) Show a small overlay form that lets the user edit and confirm before
//      sending to AnkiConnect (via the popup/options storage settings).
//
// NYT renders the crossword as SVG with <text> nodes for letters. The New
// Yorker uses a similar player. We use class-name heuristics with fallbacks
// because either site may tweak markup. PuzzleMe (Amuse Labs) is a plain-DOM
// player with stable class names, so it gets its own exact-match scraper.

(function () {
  // -------- Source detection ------------------------------------------------

  function detectSource() {
    const host = window.location.hostname;
    if (host.endsWith("amuselabs.com")) {
      return puzzleMeSet() === "vox" ? "vox" : "puzzleme";
    }
    if (host.includes("newyorker.com")) return "newyorker";
    if (host.includes("nytimes.com")) return "nyt";
    // A page that only hosts an embedded player (vox.com) has no puzzle of its
    // own — it just renders the overlay on the frame's behalf.
    return null;
  }

  // The publisher a PuzzleMe player belongs to. Vox embeds its player as
  // cdn3.amuselabs.com/vox/crossword?id=...&set=vox — either the "set" param
  // or the first path segment names the publisher.
  function puzzleMeSet() {
    const fromQuery = new URLSearchParams(window.location.search).get("set");
    if (fromQuery) return fromQuery.toLowerCase();
    const [firstSegment] = window.location.pathname.split("/").filter(Boolean);
    return (firstSegment || "").toLowerCase();
  }

  // -------- Puzzmo (New Yorker) scraping ------------------------------------

  function getPuzzmoCapture() {
    const el = document.querySelector('div[aria-live="assertive"][aria-atomic="true"]');
    if (!el) return null;
    const text = el.textContent.trim();
    // Format: "Clue 6A, Not meant to be taken metaphorically . Answer: 7 letters Letter: 7 this tile has a L , Fill: L I T E R A L"
    const clueMatch = text.match(/Clue\s+(\d+)([AaDd]),?\s+(.+?)\s*\.\s*Answer:\s*(\d+)\s*letters/);
    if (!clueMatch) return null;
    const [, , dirLetter, clueText, lengthStr] = clueMatch;
    const direction = dirLetter.toUpperCase() === "A" ? "across" : "down";
    const answerLength = parseInt(lengthStr, 10);
    const fillMatch = text.match(/Fill:\s+([A-Z\s]+)\s*$/);
    const answer = fillMatch ? fillMatch[1].replace(/\s+/g, "") : null;
    return { clue: clueText.trim(), direction, answerLength, answer };
  }

  // -------- PuzzleMe (Vox) scraping -----------------------------------------
  //
  // PuzzleMe (Amuse Labs) renders the grid as nested <div>s with stable class
  // names — no obfuscation — so these are exact matches rather than the
  // substring heuristics the NYT player needs:
  //   .hilited-box / .hilited-box-with-focus  cells of the selected word,
  //                                           in grid reading order
  //   .letter-in-box                          the letter the solver typed
  //   .clue-bar .clue-text                    the selected clue's text

  function cleanCellText(str) {
    // Empty cells are padded with a non-breaking space, and clue numbers carry
    // a trailing zero-width joiner.
    return String(str).replace(/[\s\u00a0\u200b-\u200d\ufeff]/g, "");
  }

  function getPuzzleMeCapture() {
    const cells = Array.from(
      document.querySelectorAll(".hilited-box, .hilited-box-with-focus")
    );
    if (!cells.length) return null;

    const answer = cells
      .map((cell) => {
        const letterEl = cell.querySelector(".letter-in-box");
        return letterEl ? cleanCellText(letterEl.textContent) : "";
      })
      .join("")
      .toUpperCase();

    const clueEl = document.querySelector(".clue-bar .clue-text");
    const clue = clueEl ? clueEl.textContent.trim() : null;

    // The clue bar's "1 ACROSS" label is hidden in narrow embeds, so read the
    // direction off the grid instead: a selected word is always a straight run,
    // so cells sharing a top edge means across.
    const tops = new Set(
      cells.map((cell) => Math.round(cell.getBoundingClientRect().top))
    );

    return {
      clue,
      answer,
      answerLength: cells.length,
      direction: tops.size === 1 ? "across" : "down",
    };
  }

  function getPuzzleMeDate() {
    // Publishers date-stamp the puzzle id, e.g. Vox's "PBvox_20260825_1000".
    const id = new URLSearchParams(window.location.search).get("id") || "";
    const m = id.match(/(\d{4})(\d{2})(\d{2})/);
    return m ? buildDate(m[1], m[2], m[3]) : null;
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
    const cleaned = raw.replace(/^\s*\d+\s*(?:[AD](?!\w))?\s*[\.:\-]?\s*/i, "").trim();
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

  // Build the { iso, weekday, pretty } shape from numeric date parts. Noon
  // avoids the parsed date sliding a day either way across time zones.
  function buildDate(year, month, day) {
    const d = new Date(`${year}-${month}-${day}T12:00:00`);
    if (isNaN(d)) return null;
    const weekday = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][d.getDay()];
    const monthName = d.toLocaleString("en-US", { month: "long" });
    return {
      iso: `${year}-${month}-${day}`,
      weekday,
      pretty: `${weekday}, ${monthName} ${parseInt(day, 10)}, ${year}`,
    };
  }

  function getPuzzleDate() {
    // Try the page title first — NYT includes the date there.
    const fromTitle = parseDateString(document.title);
    if (fromTitle) return fromTitle;

    // New Yorker: date may appear in the URL as /crossword/YYYY/MM/DD
    const urlMatch = window.location.pathname.match(/\/(\d{4})\/(\d{2})\/(\d{2})/);
    if (urlMatch) return buildDate(urlMatch[1], urlMatch[2], urlMatch[3]);

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
    const source = detectSource();

    if (source === "vox" || source === "puzzleme") {
      const puzzleMe = getPuzzleMeCapture();
      return {
        clue: null,
        answer: null,
        answerLength: null,
        direction: null,
        ...puzzleMe,
        date: getPuzzleMeDate(),
        source,
      };
    }

    const date = getPuzzleDate();
    if (source === "newyorker") {
      const puzzmo = getPuzzmoCapture();
      if (puzzmo) {
        return { ...puzzmo, date, source };
      }
    }
    const clue = getActiveClueText();
    const answer = getActiveAnswerLetters();
    const answerLength = getActiveAnswerLength();
    const direction = getActiveDirection();
    return { clue, answer, answerLength, direction, date, source };
  }

  // -------- Overlay UI ------------------------------------------------------

  let overlayEl = null;

  function showOverlay(captured) {
    closeOverlay();

    const overlay = document.createElement("div");
    overlay.id = "cwa-overlay";
    // Vox embeds the PuzzleMe player in an iframe sized to its content, so a
    // fixed overlay anchors to the frame rather than the browser window. Tuck
    // it into the frame's corner so it cannot hang off the player.
    if (window.top !== window.self) overlay.classList.add("cwa-overlay--embedded");
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

    const historyEl = overlay.querySelector(".cwa-history");
    let lastHistoryWord = null;

    function fetchHistory(word) {
      if (!word) return;
      const upper = word.toUpperCase();
      if (upper === lastHistoryWord) return;
      lastHistoryWord = upper;
      historyEl.innerHTML = '<div class="cwa-history-loading">Loading history…</div>';
      chrome.runtime.sendMessage(
        { type: "FETCH_WORD_HISTORY", word: upper },
        (resp) => renderHistory(historyEl, resp, captured.date?.iso)
      );
    }

    if (captured.answer) fetchHistory(captured.answer);

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
    answerEl.addEventListener("blur", () => fetchHistory(answerEl.value.trim()));
    if (!answerEl.value) answerEl.focus();
    else overlay.querySelector(".cwa-save").focus();

    // Esc to close, Cmd/Ctrl+Enter to save.
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeOverlay();
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSave(captured);
    });

    // Drag the overlay from the header or within 16px of any card edge.
    const card = overlay.querySelector(".cwa-card");
    const DRAG_EDGE = 16;

    function isDraggable(e) {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const nearEdge = x < DRAG_EDGE || x > rect.width - DRAG_EDGE ||
                       y < DRAG_EDGE || y > rect.height - DRAG_EDGE;
      const inHeader = e.target.closest(".cwa-header") && !e.target.closest(".cwa-close");
      return nearEdge || inHeader;
    }

    card.addEventListener("mousemove", (e) => {
      card.style.cursor = isDraggable(e) ? "grab" : "";
    });
    card.addEventListener("mouseleave", () => { card.style.cursor = ""; });

    card.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (!isDraggable(e)) return;
      const rect = card.getBoundingClientRect();

      // Switch from right-anchored CSS positioning to explicit left/top.
      overlay.style.right = "auto";
      overlay.style.left = rect.left + "px";
      overlay.style.top = rect.top + "px";
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;

      function onMove(ev) {
        overlay.style.left = (ev.clientX - offsetX) + "px";
        overlay.style.top = (ev.clientY - offsetY) + "px";
      }
      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      e.preventDefault();
    });
  }

  function renderHistory(historyEl, resp, currentIsoDate) {
    if (!historyEl) return;
    if (!resp || !resp.ok) {
      if (resp && resp.reason === "signin") {
        historyEl.innerHTML =
          '<div class="cwa-history-error">Sign in to <a href="https://www.xwordinfo.com/Finder" target="_blank" rel="noopener">xwordinfo.com</a> in this browser to see word history.</div>';
      } else {
        historyEl.innerHTML = "";
      }
      return;
    }
    if (!resp.count) {
      historyEl.innerHTML = "";
      return;
    }
    const clues = (resp.recentClues || []).filter(
      (e) => !currentIsoDate || !e.isoDate || e.isoDate !== currentIsoDate
    );
    const rows = clues
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
        { type: "FETCH_IMAGE", word: captured.answer, clue: captured.clue },
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
          source: captured.source,
        },
      },
      (resp) => {
        if (!overlayEl) return;
        if (chrome.runtime.lastError) {
          setStatus(chrome.runtime.lastError.message, "error");
          overlayEl.querySelector(".cwa-save").disabled = false;
          return;
        }
        if (resp && resp.ok && resp.duplicate) {
          setStatus("Card already exists in deck.", "warn");
          const saveBtn = overlayEl.querySelector(".cwa-save");
          saveBtn.textContent = "Edit in Anki";
          saveBtn.disabled = false;
          saveBtn.onclick = () => {
            chrome.runtime.sendMessage({ type: "EDIT_NOTE", noteId: resp.noteId });
            closeOverlay();
          };
        } else if (resp && resp.ok) {
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
  //
  // Vox hosts the PuzzleMe player in an iframe sized to the puzzle, so an
  // overlay rendered inside it gets clipped. The frame that owns the puzzle
  // scrapes the clue and hands it to the top frame, which renders the overlay
  // across the whole window. If nothing acknowledges the handoff the host page
  // isn't running this script, so we render in place rather than drop the
  // capture.

  const HANDOFF_ACK_MS = 200;
  let handoffTimer = null;

  function openOverlay(captured) {
    showOverlay(captured);
    initImageSection(captured);
  }

  function handleCaptureRequest() {
    // Every frame in the tab gets the hotkey message; only the one holding the
    // puzzle should act on it.
    if (!detectSource()) return;

    const captured = capture();
    if (window.top === window.self) {
      openOverlay(captured);
      return;
    }

    clearTimeout(handoffTimer);
    handoffTimer = setTimeout(() => {
      handoffTimer = null;
      openOverlay(captured);
    }, HANDOFF_ACK_MS);
    window.parent.postMessage({ type: "CWA_SHOW_OVERLAY", captured }, "*");
  }

  function isPuzzleFrameOrigin(origin) {
    try {
      return /(^|\.)amuselabs\.com$/.test(new URL(origin).hostname);
    } catch {
      return false;
    }
  }

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;

    if (data.type === "CWA_SHOW_OVERLAY") {
      // Only an embedded puzzle player may ask us to open an overlay.
      if (!isPuzzleFrameOrigin(event.origin)) return;
      if (event.source) event.source.postMessage({ type: "CWA_OVERLAY_ACK" }, "*");
      openOverlay(data.captured);
      return;
    }

    if (data.type === "CWA_OVERLAY_ACK" && event.source === window.parent) {
      clearTimeout(handoffTimer);
      handoffTimer = null;
    }
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === "CAPTURE_CLUE") {
      handleCaptureRequest();
      sendResponse({ ok: true });
    }
    return true;
  });
})();
