# Every Directory

[한국어](README.md) · **English**

A **React + Tauri 2 + Rust desktop app** combining local file search with multiple explorer panes. Build configurations are available for Windows and macOS. Packaged desktop apps run without Node.js or an HTTP server.

Version 0.12.1 [finds multi-word Latin and number queries such as `yk5 xlsx` in Quick Search, drags files out of search and explorer lists into browsers, Explorer or Finder, and shows a larger, denser Quick Search window](docs/quick-search-drag-v0.12.1.md). Version 0.12.0 [indexes network drives (SMB), WebDAV and cloud folders, keeps checkboxes unchecked when entering folders, moves between search and explorer panes with Tab, opens typed paths from Quick Search and fixes the folder tree with three or more panes](docs/network-drives-v0.12.0.md). Version 0.11.0 brings a [Windows 11 File Explorer–style interface, keyboard cursor retention after navigation, native OS file icons, clipboard type tabs with a larger Quick Search clipboard view, and clipboard history recording on macOS](docs/windows-ui-v0.11.0.md). Version 0.10.0 adds [persistent preferences, default search exclusions, initials highlighting, clipboard history, and portable Windows storage](docs/preferences-clipboard-v0.10.0.md). Type `clip` in Quick Search and press Enter to open history; retention defaults to 10 days and supports 1–60 days. Version 0.9.1 adds the [native Windows Shell New menu](docs/windows-shell-new-v0.9.1.md). Right-click in an explorer pane and click New to create types registered on the current PC, using Windows templates and naming. Version 0.9.0 persists folder-tree width per pane, expands previews, adds eight views, sorting/grouping, configurable metadata columns and per-root indexing exclusions. See the [implementation notes and remaining native Explorer scope](docs/windows-explorer-v0.9.0.md) and the [design review](docs/review/usability-design-v0.9.0.md). It does not embed the full Windows Shell. Version 0.8.0 adds paged search results, global sorting, search multi-selection and file actions, tab management, and CSV/TXT/TSV/HTML export. See the [feature audit, validation and remaining gaps](docs/usability-audit-v0.8.0.md), including an English summary. It is not full Everything/Q-Dir feature parity. The preceding version synchronizes the folder tree with each pane and active tab, and adds a [short product introduction](docs/introduction/index.html). See the [tree synchronization notes](docs/tree-sync-v0.7.11.md), which include an English summary. It retains [resizable columns, Korean IME fixes, and background index restoration](docs/columns-ime-startup-v0.7.10.md), the [compact workspace](docs/compact-workspace-v0.7.9.md), Windows Shell file operations, native same-volume renames, [incremental index updates](docs/transfer-performance-v0.7.7.md), Windows path fixes, numbered copies, keyboard shortcuts, drag and drop, uncolored new tabs, and app/license information. See also the [native transfer verification record](docs/windows-native-operations-v0.7.8.md), [Windows compatibility notes](docs/windows-compatibility.md), and [license documentation](docs/licensing.md).

## Getting started

Development requires Node.js 22.23.4, 24.22.1 or 26.12.1 (`.nvmrc` pins 24.22.1), stable Rust, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system. End users running a packaged app do not need Node.js or Rust.

```sh
npm ci
npm run desktop:dev
```

Build a desktop package:

```sh
npm run desktop:build
```

macOS application bundles are generated under `src-tauri/target/release/bundle/macos/`, with disk images under `bundle/dmg/`. Windows builds generate MSI or NSIS setup executables. Use a package matching your operating system and CPU architecture.

To package a macOS app without Finder automation, including in CI or while the screen is locked:

```sh
npm run desktop:build -- --bundles app
npm run desktop:package:mac
```

The packaging command creates a DMG and ZIP in the same output directory.

Build a Windows x64 NSIS installer:

```sh
npm run desktop:build:windows
```

Windows uses the standard Rust MSVC toolchain. Cross-compilation from macOS additionally requires `cargo-xwin`, LLVM/LLD, NSIS, and the `x86_64-pc-windows-msvc` Rust target.

The Windows package targets 64-bit Windows 10/11. Its lightweight installer does not bundle or download WebView2; install Microsoft Edge WebView2 Runtime first if it is missing. macOS uses the system WKWebView. Local macOS packages use an ad-hoc signature; Apple notarization is a separate step.

The old v0.7.4 installers contained developer build paths and have been withdrawn from source history. Build fresh packages using the commands above, or use artifacts from [Actions](https://github.com/hwanse85/every_directory/actions) runs that pass the executable privacy checks. Older release documents are historical records, not download locations.

## Using the app

1. Use **Connect folder** to register a directory with the operating system's folder picker.
2. Single-click a search result to show its location and selection in the active explorer pane. Double-click to open it with the default application.
3. Two explorer panes are shown initially. Choose one to four panes and open multiple tabs in each. Click a pane or use F6/Shift+F6 to change the active pane and keyboard focus.
4. Use **Layout** to change the position and proportions of search and explorer areas. Drag dividers or adjust them with the keyboard.
5. Use the toolbar for copy, cut, paste, rename, delete, and ZIP operations. Additional tools provide batch rename, previews, image resizing, properties, SHA-256, and app-trash restoration.
6. Explorer panes include a folder tree, current-folder filter, sortable columns, context menus, and drag-and-drop transfers. Dropping on a folder row uses that folder as the destination. External files are imported as copies.
7. Save search conditions and pane/tab workspaces with the sidebar's **+** buttons. Export loaded results as CSV, TXT, TSV or printable HTML. **Load more** retrieves results beyond 1,000. Sorting is applied before pagination; timed-out searches are explicitly partial.
8. Press Space for a preview or Ctrl/Command+Shift+P for the command palette. PDF previews support page navigation and zoom.
9. The app adds a Windows tray or macOS menu-bar icon. Closing the window keeps it running by default. Use the tray or Ctrl+Shift+Space on Windows / Command+Shift+Space on macOS for quick search. Choose **Quit completely** in the tray menu to stop the process.
10. Context menus include icons, shortcuts, and five submenu groups. Hover over an arrow to open a submenu; use Right/Left to enter or return and Escape to close it. On Windows, F5 refreshes and Shift+F5/F7 copies/moves to another pane. On macOS, F5/F7 performs those transfers. Ctrl/Command+D creates a duplicate.
11. **File tools** provides duplicate detection, folder-size analysis, and folder comparison. Settings include light/dark/system themes and list density.
12. Above search results, **Displayed columns** controls location, type, extension, size, modification time, connected folder, and full path. The name column is always visible. Choices are saved; headers sort results and wide tables scroll horizontally. **Defaults** restores name, location, size, and modification time.
13. Use the top-left sidebar button to expand the working width. Its state is saved automatically. File tools, layout, pane count, and folder connection share a single toolbar row.
14. **Drag a header boundary** to resize a column. Double-click to fit its content, use Left/Right for 10px adjustments or Shift+Left/Right for 40px, and Escape to cancel a drag. Right-click a header or use its column-settings button to fit all columns or restore default widths. Search and each explorer pane save widths independently. Narrow panes keep every attribute accessible through horizontal scrolling.
15. The folder tree automatically reveals and selects the active tab's location. Tree visibility is saved per pane, expansion per tab. Navigate with arrow keys and Enter, or Ctrl-click to open a tree location in a new tab.

## Search

Supported modes include substring search, space-separated AND terms, quoted phrases, extension filters such as `ext:pdf,docx`, wildcards (`*`, `?`), regular expressions, fuzzy matching, and Korean initial-consonant search. You can filter by connected folder and file category, and choose filename or full-path matching.

**Initials + normal search** is the default. It accepts initial consonants such as `ㅂㄱㅅ`, complete Korean words such as `보고서`, mixed input such as `보고ㅅ`, English names, and patterns such as `*.pdf`. Standalone compound consonants produced by the IME are separated during input. Tense consonants such as `ㅆ` and ordinary Korean syllables remain intact.

Korean initial-consonant matching ignores spacing differences in filenames and queries. For example, `데이터분석 발굴.pdf` matches `ㄷㅇㅌㅂㅅ ㅂㄱ`, `ㄷㅇㅌㅂㅅㅂㄱ`, and `ㄷㅇ ㅌㅂㅅㅂ ㄱ`. Space-separated terms still use AND logic. Normal search and regex retain their own whitespace semantics.

Advanced operators include OR (`|`), exclusion (`!`), grouping (`< >`), `file:`, `folder:`, `path:`, `size:>10mb`, `size:1mb..10mb`, `dm:today`, and `dm:>=2026-01-01`. OR binds more tightly than AND. For example, `report|plan !draft ext:pdf` combines alternatives, exclusion, and an extension filter.

The desktop app uses Rust's `regex` engine, which does not support look-around or backreferences. Regex and batch-replacement syntax is not identical to the legacy RE2JS implementation. Search applies NFC normalization to Korean text.

The response-time target is under one second after indexing. When the engine exceeds its 650 ms time budget, the UI explicitly marks partial results. Initial indexing is separate from query latency; performance depends on the dataset and query.

## Keyboard and tabs

| Shortcut | Action |
| --- | --- |
| Ctrl/Command+C, X, V | Copy, cut, paste real files in the active explorer |
| Delete | Confirm and move selected items to the app's restorable trash |
| F2 / Alt+Enter | Rename / properties |
| Ctrl+Shift+N | New folder |
| Ctrl/Command+A / Shift+click | Select all / select a range |
| Home / End / PageUp / PageDown | Navigate the file list; hold Shift for range selection |
| Ctrl+L / Alt+D / F4 | Edit the folder address |
| Ctrl+F / Escape | Focus the current-folder filter / clear it and return focus |
| Ctrl/Command+K | Focus main search |
| Alt+Left / Right / Up | Back / forward / parent directory |
| Ctrl/Command+T / W | Open a tab / close the current tab |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab |
| F6 / Shift+F6 | Next / previous explorer pane |
| Enter / Space / Shift+F10 | Open / preview / item context menu |

Address navigation supports absolute paths within connected folders. Connect a folder first to access locations outside the existing roots. New tabs start without an assigned color and do not inherit the previous tab's color; use the palette and clear-color button to customize them.

In text fields, clipboard shortcuts and Delete edit text. Full operating-system shell parity, general Undo, Shift+Delete permanent deletion, and dragging files out to Windows Explorer are not implemented.

## File operations and limits

- Normal operations use indexed items and user-excluded subfolders within registered roots. Indexing exclusions do not remove folders from file browsing. Symbolic links, `.git`, `node_modules`, and internal working/trash directories are excluded from indexing.
- Copies never overwrite existing files: a collision produces names such as `report (1).txt` and `report (2).txt`, retaining the extension. Move and rename collisions are reported. Connected roots and ancestors of other roots are protected; copying or moving a directory into itself is rejected.
- Mutations are serialized and update changed paths in the index. File watchers also apply incremental updates. A batch can partially complete before a later item fails.
- Delete uses `.every-directory-trash` inside the connected root, rather than the operating system's trash. Restore requires the original parent directory and refuses to overwrite an existing destination.
- File copying uses the OS file clipboard, including copies from Finder or Windows Explorer. External cut items are imported as copies. An internal cut becomes a move only when the OS clipboard still matches the selected items. Text paths and Markdown links can also be copied.
- Folder-size analysis, SHA-256 duplicate detection, and file-content comparison are read-only. Limits are 100,000 files, 4 GiB of content, and 120 seconds, with skipped items and limits reported. Analysis can be cancelled. Comparison does not cover empty folders, permissions, or extended attributes.
- ZIP creation and extraction are supported. Extraction uses a new directory, with limits of 10,000 entries and 500 MB; traversal and links are rejected. Encrypted ZIPs are unsupported.
- PNG/JPEG/WebP resizing creates copies in a new folder. Limits are 50 MB and 40 million pixels per input, 8192 pixels and 40 million pixels per output, and 50 files per batch. Defaults preserve aspect ratio and avoid enlargement. Codec-specific output, such as JPEG transparency conversion, should be checked.
- Preview supports text, images, PDF, and media playable by the OS. File reads are limited to 256 MB per request; text previews show the first 256 KB. **Save a copy** writes to a new path.
- The native desktop app excludes the OCR engine and language models. OCR remains available in the separate legacy web implementation.

## Storage and migration

The index is stored in the OS application-data directory for `com.everydirectory.desktop`. Set `EVERY_DIRECTORY_DATA` to choose another location. On first startup at the default location, the app can import connected folders from `~/.every-directory/index.json` without modifying the legacy data. UI preferences are stored in the app's WebView, separately from browser preferences.

## Verification

```sh
npm run build
npm test
npm run test:rust
npm run licenses:check
npm run privacy:check -- --history
```

Windows WebView2 end-to-end checks:

```sh
npm run test:e2e
```

The [0.7.6 record](docs/e2e-v0.7.6.md) documents 120 E2E checks and actual Korean IME/mouse verification. Test counts in older records describe those versions, not every later change. Native tests exercise real temporary files, search, file operations, ZIP, image resizing, path boundaries, file watching, and previews. Node tests cover the web-compatible implementation. CI definitions are in `.github/workflows/`; a workflow's presence alone is not evidence that it passed.

Run the optional 200,000-entry benchmark explicitly:

```sh
npm run test:rust -- --release --test engine benchmark_two_hundred_thousand_entries -- --ignored --nocapture
```

Verification-only desktop builds use `--features smoke-test` with isolated data and fixture folders. These scripts and verification IPC are excluded from normal distribution builds. A report that only says `started` is not a passing result. Physical OS dialogs, SMB authentication/reconnection, multiple DPI/monitor setups, and login/reboot behavior have separate verification limits.

## Privacy in the public repository

Build wrappers remap developer home, temporary, project, and Rust toolchain paths to generic build paths. CI checks source history and unpacked application executables before uploading distribution artifacts. Compiled installers, local indexes, verification output, and environment files do not belong in Git. See the [privacy policy and checks](docs/privacy.md).

If you cloned the repository before the privacy cleanup, make a fresh clone. Pushing an old branch can reintroduce removed information. GitHub-managed cached commits and pull-request references may require separate cleanup by GitHub Support. Third-party copyright and license notices remain intact.

## Legacy web version and quick search

```sh
npm run dev:web
```

The optional legacy server runs at `http://127.0.0.1:5173/` and requires Node.js. It is not included in desktop distribution packages. See the [legacy web record](docs/legacy-web.md).

Quick search is a separate window opened with Ctrl+Shift+Space on Windows or Command+Shift+Space on macOS. It supports opening files/folders, revealing them in the OS explorer, file/path copying, copying to connected folders, favorites, and recent history. Change the global shortcut in Settings. See the [quick-search guide](docs/quick-search.md).

## License

Third-party license and copyright notices are in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt) and the app's Settings. The repository currently has no license granting rights to the application as a whole; a public repository and open-source dependencies do not automatically license the entire app. See [licensing details](docs/licensing.md).
