# TODO

## Distribution
- [ ] Publish to the Chrome Web Store
  - [ ] Pay the one-time $5 Chrome Web Store developer registration fee
  - [ ] Bump version in `manifest.json` from `0.1.0` to something releasable
  - [ ] Write store listing copy (short description ≤132 chars, full description)
  - [ ] Add store screenshots (1280×800 or 640×400, Chrome requires at least 1)
  - [ ] Create a privacy policy and host it somewhere (required — extension uses `cookies` and `storage`)
  - [ ] Justify the `cookies` permission in the store listing (used to pass XWordInfo session to background worker)
  - [ ] Review host permissions — Chrome may flag broad permissions; narrow if possible
  - [ ] Add XWordInfo setup instructions — users must create an account and be logged in or they'll hit rate limits quickly
  - [ ] Credit XWordInfo in the store listing and README
  - [ ] Submit for review (can take a few days)

## Features
- [ ] Support more crossword sites and widgets (Wash post, latimes, etc...)
- [ ] Show a preview of the Anki card before saving
- [ ] Option to open the saved card in AnkiWeb after saving
- [ ] Firefox support (MV3 is mostly compatible, would need minor manifest tweaks)
- [ ] Support AnkiConnect over a non-default port (currently hardcoded to 8765)
- [ ] LLM-assisted image lookup — see `llm-image-lookup.md` for notes

## XWordInfo
- [ ] Better handling when not logged in — show a clearer message instead of empty history
- [ ] Cache word history locally so repeat lookups don't hit XWordInfo again

## Bugs / polish
- [ ] Newyorker capture behavior is inconsistent
