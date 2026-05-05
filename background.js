// Background service worker.
//
// - Listens for the keyboard shortcut and tells the content script to capture.
// - Listens for SAVE_CARD messages from the content script, looks up settings,
//   and either creates a new Anki note or appends a clue to an existing one.

import {
  addNote,
  findNotesByAnswer,
  getNotesInfo,
  guiEditNote,
  storeMediaFile,
  sync,
  updateNoteFields,
} from "./anki.js";

// ---- hotkey -> content script ----------------------------------------------

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "capture-clue") return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  if (
    !/^https:\/\/www\.nytimes\.com\/(crosswords|games)\//.test(tab.url || "") &&
    !/^https:\/\/www\.newyorker\.com\/puzzles-and-games-dept\/crossword/.test(tab.url || "")
  ) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "CAPTURE_CLUE" });
  } catch (err) {
    console.warn("Could not message content script:", err);
  }
});

// ---- first-install: open settings ------------------------------------------

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") {
    chrome.runtime.openOptionsPage();
  }
});

// ---- message handler -------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "SAVE_CARD") {
    handleSaveCard(msg.payload)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // keep channel open for async response
  }

  if (msg && msg.type === "EDIT_NOTE") {
    guiEditNote(msg.noteId)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg && msg.type === "FETCH_WORD_HISTORY") {
    fetchWordHistory(msg.word)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (msg && msg.type === "FETCH_IMAGE") {
    fetchImageForWord(msg.word, msg.clue)
      .then((imageUrl) => sendResponse({ imageUrl }))
      .catch(() => sendResponse({ imageUrl: null }));
    return true;
  }
});

// ---- Wikipedia image lookup ------------------------------------------------

const STOP_WORDS = new Set([
  "a", "an", "the", "of", "in", "on", "at", "to", "for", "with",
  "by", "from", "as", "is", "was", "are", "were", "be", "or", "and",
  "its", "it", "that", "this",
]);

function extractKeywords(clue) {
  return clue
    .replace(/[^a-z\s]/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w.toLowerCase()))
    .join(" ");
}

async function fetchWikipediaThumbnail(title) {
  const resp = await fetch(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
    { headers: { Accept: "application/json" } }
  );
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.thumbnail?.source || null;
}

async function searchWikipediaTitle(query) {
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&list=search` +
    `&srsearch=${encodeURIComponent(query)}&format=json&srlimit=1`;
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.query?.search?.[0]?.title || null;
}

async function fetchImageForWord(word, clue) {
  // Wikipedia titles are title-case; crossword answers are ALL-CAPS.
  const title = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

  // 1. Direct page lookup.
  const direct = await fetchWikipediaThumbnail(title);
  if (direct) return direct;

  // 2. Search with answer + clue keywords first — avoids false matches from
  //    answer-only searches hitting unrelated pages (e.g. "Omeara" → music venue).
  if (clue) {
    const keywords = extractKeywords(clue);
    if (keywords) {
      const clueSearchTitle = await searchWikipediaTitle(`${title} ${keywords}`);
      if (clueSearchTitle && clueSearchTitle.toLowerCase() !== title.toLowerCase()) {
        const clueSearchImg = await fetchWikipediaThumbnail(clueSearchTitle);
        if (clueSearchImg) return clueSearchImg;
      }
    }
  }

  // 3. Fallback: search on just the answer — handles plurals/variants like "Riels" → "Cambodian riel".
  const answerSearchTitle = await searchWikipediaTitle(title);
  if (answerSearchTitle && answerSearchTitle.toLowerCase() !== title.toLowerCase()) {
    const answerSearchImg = await fetchWikipediaThumbnail(answerSearchTitle);
    if (answerSearchImg) return answerSearchImg;
  }

  return null;
}

// ---- XWordInfo word history ------------------------------------------------
//
// XWordInfo's Finder is an ASP.NET WebForms page, not a JSON API. We must:
//   1. GET /Finder to extract the per-session anti-CSRF tokens (__VIEWSTATE etc.)
//   2. POST /Finder with those tokens + the word to get the results HTML.
//   3. Parse the HTML response for the appearance count and recent clues.
//
// `credentials: "include"` sends the browser's xwordinfo.com session cookie
// automatically (works because the extension has host_permissions for the site).

async function fetchWordHistory(word) {
  console.log("[CWA] fetchWordHistory start:", word);
  try {
    const getResp = await fetch("https://www.xwordinfo.com/Finder", {
      credentials: "include",
    });
    console.log("[CWA] GET status:", getResp.status);
    if (!getResp.ok) return { ok: false };
    const getHtml = await getResp.text();

    const viewState = extractInputValue(getHtml, "__VIEWSTATE");
    const viewStateGen = extractInputValue(getHtml, "__VIEWSTATEGENERATOR");
    const eventValidation = extractInputValue(getHtml, "__EVENTVALIDATION");
    console.log("[CWA] viewState found:", !!viewState);
    if (!viewState) return { ok: false };

    const body = new URLSearchParams({
      __EVENTTARGET: "",
      __EVENTARGUMENT: "",
      __VIEWSTATE: viewState,
      __VIEWSTATEGENERATOR: viewStateGen,
      __EVENTVALIDATION: eventValidation,
      "ctl00$CPHContent$SortBy": "rbDate",
      "ctl00$CPHContent$RetLen": "rbAllLen",
      "ctl00$CPHContent$LenBox": "15",
      "ctl00$CPHContent$ClueBy": "rbDate",
      "ctl00$CPHContent$WordBox": word,
      "ctl00$CPHContent$SearchBut": "Search",
    });

    const postResp = await fetch("https://www.xwordinfo.com/Finder", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    console.log("[CWA] POST status:", postResp.status);
    if (!postResp.ok) return { ok: false };

    return parseFinderHtml(await postResp.text());
  } catch (err) {
    console.log("[CWA] fetchWordHistory error:", err);
    return { ok: false };
  }
}

function extractInputValue(html, name) {
  // Match <input ... name="NAME" ... value="VALUE" ...> in either attribute order.
  const re1 = new RegExp(`name="${name}"[^>]*?value="([^"]*)"`, "i");
  const re2 = new RegExp(`value="([^"]*)"[^>]*?name="${name}"`, "i");
  const m = html.match(re1) || html.match(re2);
  return m ? m[1] : null;
}

function parseFinderHtml(html) {
  // DOMParser is not available in MV3 service workers — parse with regex.

  // Count: match "87 total results for WORD"
  let count = 0;
  const countMatch =
    html.match(/(\d+)\s+total\s+results?\s+for/i) ||
    html.match(/appears?\s+(\d+)\s+times?/i) ||
    html.match(/found\s+(\d+)/i);
  if (countMatch) count = parseInt(countMatch[1], 10);

  function cellText(inner) {
    return inner
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .trim();
  }

  // Results table columns: Date | Grid | Clue | Author | Editor
  // Only rows with a data-date attribute are actual result rows.
  const recentClues = [];
  const trRe = /<tr[\s\S]*?<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRe.exec(html)) !== null && recentClues.length < 6) {
    const rowHtml = trMatch[0];
    if (!rowHtml.includes("data-date=")) continue; // skip header/form rows

    const cells = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let tdMatch;
    while ((tdMatch = tdRe.exec(rowHtml)) !== null) {
      // Strip the (N) repeats count from clue cells before extracting text.
      const cleaned = tdMatch[1].replace(/<span[^>]*class=['"]repeats['"][^>]*>[\s\S]*?<\/span>/g, "");
      cells.push(cellText(cleaned));
    }

    // cells[0]=date, cells[1]=grid, cells[2]=clue
    if (cells.length >= 3 && cells[0] && cells[2]) {
      recentClues.push({ date: cells[0], clue: cells[2] });
    }
  }

  console.log("[CWA] parseFinderHtml: count =", count, "| clues found =", recentClues.length);

  if (!count && !recentClues.length) return { ok: false };
  return { ok: true, count, recentClues };
}

// ---- settings / save -------------------------------------------------------

async function getSettings() {
  const s = await chrome.storage.sync.get([
    "deckName",
    "modelName",
    "clueField",
    "answerField",
    "notesField",
    "sourceField",
    "dateField",
    "lengthField",
    "imageField",
    "autoFetchImage",
    "extraTags",
  ]);
  if (!s.deckName || !s.modelName || !s.clueField || !s.answerField) {
    throw new Error(
      "Extension not configured yet. Open the options page to pick a deck and note type."
    );
  }
  return s;
}

function buildTags(payload, extraTags) {
  const source = payload.source || "nyt";
  const tags = ["crossword", source];
  if (payload.date && payload.date.weekday) {
    tags.push(`${source}-${payload.date.weekday.toLowerCase()}`);
  }
  if (extraTags) {
    extraTags
      .split(/[,\s]+/)
      .filter(Boolean)
      .forEach((t) => tags.push(t));
  }
  return tags;
}

async function handleSaveCard(payload) {
  const settings = await getSettings();

  // 1) Look for an existing note in this deck whose answer field matches.
  //    If we find one, append the new clue to its clue field (with " / ")
  //    rather than creating a duplicate. Crossword answers recur with
  //    different clues constantly, so this is more useful than dedupe-skip.
  const existingIds = await findNotesByAnswer(
    settings.deckName,
    settings.answerField,
    payload.answer
  );

  if (existingIds && existingIds.length) {
    const [info] = await getNotesInfo([existingIds[0]]);
    return {
      duplicate: true,
      noteId: info.noteId,
      message: "Card already exists in deck.",
    };
  }

  // 2) No existing note - create one.
  const fields = {
    [settings.clueField]: payload.clue,
    [settings.answerField]: payload.answer,
  };
  if (settings.notesField && payload.notes) {
    fields[settings.notesField] = payload.notes;
  }
  if (settings.sourceField) {
    fields[settings.sourceField] = payload.source === "newyorker" ? "New Yorker" : "NYT";
  }
  if (settings.dateField && payload.date) {
    fields[settings.dateField] = payload.date.iso;
  }
  if (settings.lengthField && payload.answerLength) {
    fields[settings.lengthField] = String(payload.answerLength);
  }
  if (settings.imageField && payload.imageUrl) {
    try {
      const ext = (payload.imageUrl.split(".").pop().split("?")[0] || "jpg").toLowerCase();
      const safeAnswer = payload.answer.replace(/[^A-Z0-9]/gi, "_");
      const filename = `crossword_${safeAnswer}.${ext}`;
      await storeMediaFile(filename, payload.imageUrl);
      fields[settings.imageField] = `<img src="${filename}">`;
    } catch {
      // Image storage failure should not block the card save
    }
  }

  await addNote({
    deckName: settings.deckName,
    modelName: settings.modelName,
    fields,
    tags: buildTags(payload, settings.extraTags),
  });

  sync().catch(() => {});
  return { message: "Added new card." };
}
