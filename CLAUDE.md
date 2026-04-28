# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Chrome extension (Manifest V3) that captures clue/answer pairs from NYT and New Yorker crossword puzzles and adds them to Anki via AnkiConnect (which must be running locally on port 8765).

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
| `content.js` | Injected into NYT / New Yorker pages | DOM scraping (clue, answer letters from SVG grid, date), overlay UI |
| `popup.js` | Toolbar popup | Detects active tab, triggers capture or opens options |
| `options.js` | Options page | Reads live decks/models from Anki, maps fields, saves settings to `chrome.storage.sync` |

`anki.js` is an ES module imported by `background.js` and `options.js`. All AnkiConnect calls must go through it.

## Key design decisions

- **Deduplication by answer**: `handleSaveCard` in `background.js` searches the target deck for an existing note whose answer field matches. If found, it appends the new clue with ` / ` rather than creating a duplicate. The exact behavior is in `background.js:handleSaveCard`.
- **DOM selectors use substring matching** (`[class*="..."]`) because NYT obfuscates/rotates class names. If capture breaks after an NYT redesign, `content.js` is the first place to look.
- **XWordInfo scraping**: The word history feature in `background.js:fetchWordHistory` does a two-step GET+POST against XWordInfo's ASP.NET WebForms page to extract CSRF tokens, then parses the results HTML with regex (DOMParser is unavailable in service workers).
- **Settings** are stored in `chrome.storage.sync`: `deckName`, `modelName`, `clueField`, `answerField`, and optional `notesField`, `sourceField`, `dateField`, `extraTags`.
- **Tags** auto-applied to every card: `crossword`, the source (`nyt` or `newyorker`), and a day-of-week tag like `nyt-saturday`.

## Adding new AnkiConnect actions

Add a new exported function to `anki.js` using `ankiInvoke(actionName, params)`, then import and call it from `background.js` or `options.js`.
