// Background service worker.
//
// - Listens for the keyboard shortcut and tells the content script to capture.
// - Listens for SAVE_CARD messages from the content script, looks up settings,
//   and either creates a new Anki note or appends a clue to an existing one.

import {
  addNote,
  findNotesByAnswer,
  getNotesInfo,
  updateNoteFields,
} from "./anki.js";

// ---- hotkey -> content script ----------------------------------------------

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "capture-clue") return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  if (!/^https:\/\/www\.nytimes\.com\/(crosswords|games)\//.test(tab.url || "")) {
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

// ---- save handler ----------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "SAVE_CARD") {
    handleSaveCard(msg.payload)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // keep channel open for async response
  }
});

async function getSettings() {
  const s = await chrome.storage.sync.get([
    "deckName",
    "modelName",
    "clueField",
    "answerField",
    "notesField",
    "sourceField",
    "dateField",
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
  const tags = ["crossword", "nyt"];
  if (payload.date && payload.date.weekday) {
    tags.push(`nyt-${payload.date.weekday.toLowerCase()}`);
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
    const currentClue = (info.fields[settings.clueField] || {}).value || "";
    // Avoid double-adding if the same clue is already there.
    const already = currentClue
      .split(/\s*\/\s*/)
      .map((s) => s.trim().toLowerCase())
      .includes(payload.clue.toLowerCase());

    if (already) {
      return { message: "Already in deck — clue unchanged." };
    }

    const merged = currentClue
      ? `${currentClue} / ${payload.clue}`
      : payload.clue;

    await updateNoteFields(info.noteId, {
      [settings.clueField]: merged,
    });
    return { message: "Appended clue to existing card." };
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
    fields[settings.sourceField] = "NYT";
  }
  if (settings.dateField && payload.date) {
    fields[settings.dateField] = payload.date.iso;
  }

  await addNote({
    deckName: settings.deckName,
    modelName: settings.modelName,
    fields,
    tags: buildTags(payload, settings.extraTags),
  });

  return { message: "Added new card." };
}
