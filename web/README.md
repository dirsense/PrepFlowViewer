# UI development guide

The same interface runs in the local server, the Windows desktop window and exported standalone HTML.

## Files

| File | Responsibility |
| --- | --- |
| `viewer.html` / `viewer.css` | Markup, dialogs, control IDs, layout and styling |
| `assets.json` | JavaScript and CSS embedding order |
| `viewer.js` | Event registration and startup |
| `viewer-state.js` | Shared model, selection, viewport and utilities |
| `viewer-graph.js` / `comment-layout.js` | Flow diagram, icons, zoom and comment layout |
| `viewer-navigation.js` | Initialization, selection and step navigation |
| `viewer-detail.js` | Fields, changes and step settings |
| `viewer-overview.js` | Flow overview, connections and help |
| `viewer-formula.js` | Formula preview, editor and draft history |
| `viewer-flow-edit.js` | Confirmed edits, Undo/Redo, saving and close checks |
| `formula.js` / `formula-format.js` / `formula-edit.js` | Tokenization, formatting and editing history |
| `filter-display.js` | Filter display formatting |
| `viewer-files.js` / `batch-export.js` | Opening files, history, drops and HTML export |
| `flow-run.js` / `output-edit.js` | Run progress and output editing |
| `viewer-publish.js` | Tableau Server authentication and publishing |
| `i18n.js` / language JSON files | Translation, language preferences and refresh |

## Loading and state

`prepflow.render_html()` embeds assets in manifest order. These are ordinary scripts sharing one scope, not isolated ES modules. Place dependencies before their consumers and keep `viewer.js` last. Exported HTML is self-contained and requires no CDN or build step. Windows bundles the same `web` directory.

- `DATA` holds the parsed flow and `byId` indexes its steps. `selected`, `activeTab` and `overviewTab` track selection.
- `positions`, `scale`, `offset`, `autoFit` and `expandedComments` track the viewport. Preserve them when refreshing data or language.
- `formulaPopup.history` contains unconfirmed draft edits. Discarding a draft must not enter flow history.
- `flowSessions` and `flowSession.history` retain confirmed edits. `confirmFormula()` updates history only after the server accepts the change. Saving the flow marks that state as saved.
- `CAN_EDIT` comes from server configuration. Standalone exports are read-only. The server also validates request tokens, file revisions and save targets.
- Author UI messages in English and translate them through `ui` / `uiBind`. All catalogs use English keys; `ja.json` contains Japanese translations. Keep user-authored names, formulas, comments and paths verbatim. Escape inserted HTML with `esc()`.

## Development checks

Use Node.js 22 or later for frontend tooling. End users do not need Node.js.

```powershell
npm ci
npm run format
npm run format:check
npm test
python -m unittest discover -s tests -v
```

Python publishing tests require `tableauserverclient`. When dependencies are installed in `.build-tools`, set `$env:PYTHONPATH = (Resolve-Path .build-tools).Path`. Tests use mocks or local servers rather than publishing real flows.

Prettier is configured in `.prettierrc.json`; whitespace conventions are in `.editorconfig`. Preserve significant whitespace in HTML/SVG template strings and CSS override order. `tests/viewer-source.cjs` parses the asset manifest and source AST, so tests do not depend on function line counts or file locations.

After interface changes, verify opening, selection, confirming/discarding edits, Undo/Redo, saving and language switching in both the editable interface and standalone HTML.

## Documentation and media

English is the default: `README.md`, `manual.html` and `DISTRIBUTION.txt`. Japanese editions use `.jp` in their names. Keep language links working both online and in the distribution. Detailed user instructions belong in the illustrated guides; keep the README brief.

`.github/workflows/manual-pages.yml` publishes both guides to GitHub Pages, with the English guide as the index. The Windows build includes `manual.html`, `manual.jp.html`, `DISTRIBUTION.txt` and `DISTRIBUTION.jp.txt`. Rebuild the ZIP after updating packaged documents.

Guide figures embed PNGs with SVG annotations. Capture the actual interface in the guide's language; use English Superstore for English demonstrations. Do not add third-party community flows to the repository. Check media for local paths and connection details before publishing.

Update figures by matching `data-guide-image` IDs to named PNGs and `shots.json`, using `python tools/update_manual_images.py output/guide-captures --manual manual.html`. Update image dimensions and callout coordinates together. Capture at twice the display resolution and record `pixelRatio: 2`. Keep steps vertically stacked and check the normal view, enlargement, narrow screens and offline links.

`tools/build_readme_demo.py --language en --format mp4` builds English video from captured frames and a timeline under `output/readme-demo-en`. It requires Pillow and `imageio-ffmpeg`. Japanese captions are maintained separately. Upload MP4s as GitHub video attachments and put the returned URL on its own README paragraph to display playback controls.
