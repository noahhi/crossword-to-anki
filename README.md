# Crossword to Anki

A Chrome extension that captures clue/answer pairs from NYT crossword puzzles and adds them as cards to your Anki deck via AnkiConnect.

<img width="200" alt="image" src="https://github.com/user-attachments/assets/7b851da1-ab26-44fe-80e3-6595f3e5fce3" />

## How it works

While you're solving on `nytimes.com/crosswords` or `nytimes.com/games`, hit `Ctrl+Shift+A` (or `Cmd+Shift+A` on Mac). A small overlay pops up pre-filled with the active clue and the letters in the answer. Tweak anything if you need to, click **Save to Anki**, and the card lands in the deck and note type you picked at setup.

If you've already saved a card with the same answer (e.g., you've seen `OREO` clued differently before), the new clue is appended to the existing card instead of creating a duplicate. So your `OREO` card grows over time into a list of every way the NYT has clued it.

Each card is auto-tagged with `crossword`, `nyt`, and the puzzle's day-of-week (e.g. `nyt-saturday`), which is useful because difficulty varies wildly by day.

## One-time setup

### 1. Install AnkiConnect in Anki

1. In Anki: **Tools → Add-ons → Get Add-ons…**
2. Paste code: `2055492159`
3. Restart Anki.

### 2. Install this extension (unpacked)

1. Open `chrome://extensions` in Chrome.
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked** and select this folder.
4. Note the extension ID Chrome assigns (long random string under the extension name). You'll need it in the next step.

### 3. Allow this extension to talk to Anki

By default AnkiConnect only accepts requests from `http://localhost`. We need to add the extension's origin.

1. In Anki: **Tools → Add-ons**, select **AnkiConnect**, click **Config**.
2. Find the `webCorsOriginList` array and add an entry: `chrome-extension://YOUR_EXTENSION_ID` (paste the ID from the previous step).

   Example:
   ```json
   {
     "webCorsOriginList": [
       "http://localhost",
       "chrome-extension://abcdefghijklmnopqrstuvwxyz123456"
     ]
   }
   ```
3. Click **OK** and restart Anki.

The extension's options page shows the exact `chrome-extension://...` line you should paste, so you don't have to copy the ID by hand.

### 4. Configure deck and note type

1. Click the extension icon, then **Settings**. (It also opens automatically the first time you install.)
2. The page lists your decks and note types pulled live from Anki.
3. Pick the deck where new cards should go.
4. Pick the note type and map at minimum the **Clue** and **Answer** fields. The extension will guess sensibly (e.g., `Front`/`Back` or `Clue`/`Answer`); change them if needed.
5. Optionally add extra tags. Save.

You're done. Open a NYT crossword, hit `Ctrl/Cmd+Shift+A` on a clue, and try it.

## Files

- `manifest.json` — extension manifest (MV3)
- `background.js` — service worker; handles hotkey + save messages, talks to Anki
- `anki.js` — AnkiConnect client (shared between background and options)
- `content.js` / `content.css` — runs on NYT pages; reads the puzzle DOM, shows the capture overlay
- `popup.html` / `popup.js` / `popup.css` — toolbar popup
- `options.html` / `options.js` / `options.css` — first-run setup and reconfiguration
- `icons/` — toolbar icons

## Troubleshooting

**"Could not reach AnkiConnect"** — Anki isn't running, AnkiConnect isn't installed, or the extension's origin isn't in `webCorsOriginList`. Restart Anki after editing the AnkiConnect config.

**The overlay shows the right clue but no answer** — The active answer is read by collecting letters from highlighted cells in the SVG grid. If the cells aren't filled in yet, you'll get an empty string. Either fill in the entry first, or just type the answer into the overlay manually.

**Hotkey doesn't trigger** — Chrome may have assigned the same combo to another extension. Visit `chrome://extensions/shortcuts` to reassign.

**The clue or answer fields are wrong on a Variety / Mini puzzle** — Layout differs across puzzle types. The selectors in `content.js` target the standard daily crossword. Open an issue (or edit `content.js` directly) if you want Mini support.

## Notes for hacking on this

- NYT sometimes adjusts class names. The selectors in `content.js` use `[class*="..."]` substring matching to be resilient, but if a future redesign breaks capture, that's the file to look at first.
- All AnkiConnect calls go through `anki.js`. Add new actions there.
- The dedupe-by-answer / append-clue behavior lives in `handleSaveCard` in `background.js`. If you'd rather have strict deduplication or always-create-new behavior, that's the spot.
