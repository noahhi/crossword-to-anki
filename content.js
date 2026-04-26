// Content script injected into NYT crossword pages.
//
// Two responsibilities:
//   1) Read the currently-active clue and the letters of its answer from the DOM.
//   2) Show a small overlay form that lets the user edit and confirm before
//      sending to AnkiConnect (via the popup/options storage settings).
//
// NYT renders the crossword as SVG with <text> nodes for letters. The clue
// list is HTML. We use class-name heuristics with fallbacks because NYT
// occasionally tweaks markup.

(function () {
  // -------- DOM scraping ----------------------------------------------------

  function getActiveClueElement() {
    // Primary: the clue list highlights the active clue with a class
    // containing "Clue-active". Fall back to aria-selected.
    return (
      document.querySelector('[class*="xwd__clue--selected"]') ||
      document.querySelector('[class*="Clue-active"]') ||
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
    const list = el.closest('[class*="ClueList"]') || el.closest("section");
    if (!list) return null;
    const heading = list.querySelector("h3, h2, [class*='Header']");
    if (!heading) return null;
    const t = heading.innerText.toLowerCase();
    if (t.includes("across")) return "across";
    if (t.includes("down")) return "down";
    return null;
  }

  function getActiveAnswerLetters() {
    // The grid uses <g> groups per cell with classes like "xwd__cell"
    // and the active word's cells get a "xwd__cell--highlighted" or similar
    // class. The currently focused cell typically has "xwd__cell--selected".
    // We collect all highlighted cells in DOM order and read their <text>.
    const highlighted = document.querySelectorAll(
      '[class*="xwd__cell--highlighted"], [class*="cell--highlighted"]'
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

  function getPuzzleDate() {
    // NYT puts the puzzle date in the page title and in a header element.
    const title = document.title; // e.g. "NYT Crossword: Saturday, April 25, 2026"
    const m = title.match(
      /(Sun|Mon|Tues|Wednes|Thurs|Fri|Satur)day,\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/
    );
    if (!m) return null;
    const [, dayPrefix, month, day, year] = m;
    const dayMap = {
      Sun: "Sunday",
      Mon: "Monday",
      Tues: "Tuesday",
      Wednes: "Wednesday",
      Thurs: "Thursday",
      Fri: "Friday",
      Satur: "Saturday",
    };
    return {
      iso: new Date(`${month} ${day}, ${year}`).toISOString().slice(0, 10),
      weekday: dayMap[dayPrefix] || null,
      pretty: `${dayMap[dayPrefix]}, ${month} ${day}, ${year}`,
    };
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
    return { clue, answer, answerLength, direction, date };
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

    const clueWithLength =
      captured.clue && captured.answerLength
        ? `${captured.clue} (${captured.answerLength})`
        : captured.clue || "";
    overlay.querySelector(".cwa-clue").value = clueWithLength;
    overlay.querySelector(".cwa-answer").value = captured.answer || "";

    const metaBits = [];
    if (captured.direction) metaBits.push(captured.direction);
    if (captured.date) metaBits.push(captured.date.pretty);
    overlay.querySelector(".cwa-meta").textContent = metaBits.join(" · ");

    overlay.querySelector(".cwa-close").addEventListener("click", closeOverlay);
    overlay.querySelector(".cwa-cancel").addEventListener("click", closeOverlay);
    overlay.querySelector(".cwa-save").addEventListener("click", () =>
      handleSave(captured)
    );

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
      sendResponse({ ok: true });
    }
    return true;
  });
})();
