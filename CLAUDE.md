# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Chrome extension (Manifest V3) that captures clue/answer pairs from NYT, New Yorker and Vox crossword puzzles and adds them to Anki via AnkiConnect (which must be running locally on port 8765).

## Loading / testing the extension

There is no build step. Load the directory directly as an unpacked extension:

1. Open `chrome://extensions`, enable **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. After any JS/HTML/CSS change, click the reload icon on `chrome://extensions` for the extension (or use the Extensions toolbar menu). Content scripts require reloading the target tab too.

## Architecture

The extension has four distinct execution contexts, each with restricted APIs:

| File | Context | Role |
|------|---------|------|
| `background.js` | Service worker | Hotkey listener, `SAVE_CARD` / `FETCH_WORD_HISTORY` message handler, AnkiConnect calls, XWordInfo scraping |
| `content.js` | Injected into NYT / New Yorker pages, and into the PuzzleMe frame (`*.amuselabs.com`, `all_frames`) | DOM scraping (clue, answer letters, date), overlay UI |
| `popup.js` | Toolbar popup | Detects active tab, triggers capture or opens options |
| `options.js` | Options page | Reads live decks/models from Anki, maps fields, saves settings to `chrome.storage.sync` |

`anki.js` is an ES module imported by `background.js` and `options.js`. All AnkiConnect calls must go through it.

## Key design decisions

- **Deduplication by answer**: `handleSaveCard` in `background.js` searches the target deck for an existing note whose answer field matches. If found, it appends the new clue with ` / ` rather than creating a duplicate. The exact behavior is in `background.js:handleSaveCard`.
- **DOM selectors use substring matching** (`[class*="..."]`) because NYT obfuscates/rotates class names. If capture breaks after an NYT redesign, `content.js` is the first place to look.
- **Vox runs on PuzzleMe** (Amuse Labs), embedded as an iframe from `cdn3.amuselabs.com/vox/crossword?id=...&set=vox`. The content script therefore matches `https://*.amuselabs.com/*` with `all_frames: true`, and the overlay renders inside that frame (`.cwa-overlay--embedded` keeps it inside the frame's box). PuzzleMe's class names are stable and unobfuscated, so `getPuzzleMeCapture` matches them exactly: `.hilited-box`/`.hilited-box-with-focus` for the selected word's cells, `.letter-in-box` for the typed letter, `.clue-bar .clue-text` for the clue. Direction is read from cell geometry rather than the `.CLUE-DIRECTION` label, which narrow embeds hide. The puzzle date comes from the `id` query param (Vox stamps it, e.g. `PBvox_20260825_1000`). Any other PuzzleMe publisher is handled by the same path and tagged `puzzleme`.
- **Hotkey URL matching** lives in `CROSSWORD_URL_PATTERNS` (`background.js`) and `SITES` (`popup.js`); keep the two in sync. Vox needs the *article* URL listed because the hotkey fires against the top-level `vox.com` tab while the content script lives in the iframe.
- **Cross-frame overlay handoff**: `content.js` is injected into both the PuzzleMe frame and the Vox host page. Only the frame with a puzzle acts on `CAPTURE_CLUE` (`detectSource()` returns `null` for the host page); it scrapes the clue and `postMessage`s `CWA_SHOW_OVERLAY` to the top frame, which renders the overlay over the whole window and replies `CWA_OVERLAY_ACK`. A fixed overlay inside the iframe is positioned against the *frame*, so once the grid is scrolled into view the card is clipped or entirely off-screen. Messages are accepted only from an `*.amuselabs.com` origin. If no ack arrives within `HANDOFF_ACK_MS` the frame renders in place (`.cwa-overlay--embedded`) so the capture is never dropped.
- **XWordInfo scraping**: The word history feature in `background.js:fetchWordHistory` does a two-step GET+POST against XWordInfo's ASP.NET WebForms page to extract CSRF tokens, then parses the results HTML with regex (DOMParser is unavailable in service workers).
- **Settings** are stored in `chrome.storage.sync`: `deckName`, `modelName`, `clueField`, `answerField`, and optional `notesField`, `sourceField`, `dateField`, `extraTags`.
- **Tags** auto-applied to every card: `crossword`, the source (`nyt`, `newyorker`, `vox` or `puzzleme`), and a day-of-week tag like `nyt-saturday`. The source travels in the `SAVE_CARD` payload from `content.js`; `SOURCE_LABELS` in `background.js` maps it to the display name written to the optional source field.

## Adding new AnkiConnect actions

Add a new exported function to `anki.js` using `ankiInvoke(actionName, params)`, then import and call it from `background.js` or `options.js`.
