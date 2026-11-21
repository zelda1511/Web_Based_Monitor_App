# Webase System Monitor

Windows-only desktop app: see what runs and what is installed, uninstall apps, update apps and drivers, clean leftovers and temp files. Electron 45 (main process, plain JS) with an Angular 22 + SCSS + Bootstrap UI. Git repo is this folder; the build plan and every phase's results live one level up in `../PLAN.md` (about 190 KB, outside git). Read the section for the phase you touch, not the whole file.

## Layout
- `electron/` main process, one module per area (`software.js`, `cleanup.js`, `winget.js`...), each with a `*.test.js` next to it. No TypeScript, no build step.
- `electron/main.js` registers every IPC channel; `electron/preload.js` is the allow-list the page sees as `window.api`. A new action needs both, one at a time, plus a test.
- `src/app/<page>/` Angular pages, each with a `*.spec.ts` (Vitest). Prettier config is in `.prettierrc`.

## Commands
- `npm start` builds Angular (development) and opens the window. No hot reload: run it again after a change.
- `npm run test:main` Node tests for `electron/`. `npm test` Angular tests (Vitest).
- `test:main` lists every test file by name in `package.json`: a new `electron/*.test.js` is not run until you add it there.
- One test: `node --test electron/winget.test.js` (main) or `npx ng test --include src/app/format.spec.ts` (Angular). `README.md` is the stock Angular CLI text; ignore it.
- `npm run test:live` runs `driver-install.live.test.js`: needs the internet, takes about 20 s (a Windows Update search), changes nothing. Not part of `test:main`.
- `npm run pack` / `dist` / `dist:installer` build into `release/`. The NSIS installer cannot be built or run on this PC (see Phase 7).
- After a fresh `npm install` Electron's exe is missing: run `node node_modules/electron/install.js` once.
- Smart App Control is on here: the first launch of an unsigned exe can be blocked once.

## Safety rules (the app deletes files and registry keys, so these are not optional)
- `contextIsolation` on, `nodeIntegration` off. The page never sends a path, a registry key or a command line: it sends ids from the latest scan or an app's registry key, and the main process looks up the rest.
- Never build a shell string from UI input. Run programs with an argument array; pass user data to PowerShell as data.
- Anything that deletes or uninstalls: preview, then confirm, then back up first. Enforce the rules in the main process, not only in the UI. Links and junctions are never followed.
- Changes that need administrator rights are refused with a clear message. Do not self-elevate; this session is not elevated.
- A new live metric must not start a process on every call (`si.mem()` and `si.fsSize()` did). Check before adding one.
- Angular under `file://`: `withHashLocation()` and `<base href="index.html">`. Do not change either.

## Testing destructive actions
- Throwaway items only, never the user's real software. Match a test program by its full unique name, never a substring (a "ping" search once ended a real game process).
- Live scripts must abort unless the dialog or page names exactly the test item.
- Test copies set `WEBASE_DATA_DIR` so settings and the single-instance lock stay out of the user's own copy. Before `npm run dist`, make sure no copy is running from `release\`.
- Do not go beyond what the user approved (the leftovers scan once planted extra items); if you do, say so.

## UI design
- Look: "telemetry" (chosen 2026-11-21), a dense instrument-panel tool on Bootstrap 5.3 (no extra UI package): flat panels with a header strip (`.panel-bar`), small uppercase panel and column labels, tight table rows, 13 px text, numbers in `var(--font-mono)`. All colours, radii and sizes are tokens at the top of `src/styles.scss`, defined for both themes. Components use `var(--token)`, never a hex value. Bootstrap is imported part by part in `src/bootstrap-parts.scss`: add the import there before using a new Bootstrap component class.
- One accent (green: `#3ddc97` dark, `#08704b` light; amber `--viz-ram` only for the memory line and big memory bars). One radius scale: `--r-ctl` controls, `--r-card` panels, `--r-dlg` dialogs, full pills only for chips, switches and meters.
- Navigation is a top bar (brand, Ctrl+K field, theme switch) over a side nav of 5 sections; the open section lists its pages under it. The list is `SECTIONS` in `src/app/app.ts`: add a page there (and in `app.routes.ts`), never in the template. `app.spec.ts` checks that all 14 pages appear once with their routes and labels.
- Text colours were checked at WCAG AA in both themes (numbers in `../PLAN.md`, "UI pass 4"). Re-check a new colour pair before using it.
- Before finishing UI work run `npm run build` (component styles are limited to 4 kB warn / 8 kB error) and `npm test`, and look at the page in light and dark. A test copy's window is "hidden" while another window covers it, which pauses the polling pages: start it with `--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows` to screenshot it.
- The packaged app does not update itself: `npm start` rebuilds, but `release\win-unpacked` only changes with `npm run pack` (and the zip with `npm run dist`). After UI work, say which of them is stale.

## Conventions
- `// shortcut:` marks a deliberate shortcut and what would upgrade it. Keep using it.
- After finishing a phase, add to `../PLAN.md` what was checked and what was not (a "Not checked / limits" list), and any mistake made. Say "unverified" when it is.
- Windows-only for now. Phase M (macOS) is planned, nothing built; do not start it before the user answers its decisions.
