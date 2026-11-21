# Webase System Monitor

A Windows desktop app that shows what is running and what is installed, and helps you clean up: uninstall apps, update apps and drivers, remove leftovers and temporary files. It also has pages for startup items, battery, recorded CPU and memory history, blocked files, and a read-only look at Windows' own protection settings.

Windows only. Built with Electron and Angular. Licensed under the [MIT License](LICENSE).

## Safety

The app can delete files and registry keys, so it is careful:

- Anything that deletes or uninstalls shows a preview, asks you to confirm, and makes a backup first.
- It never self-elevates. Changes that need administrator rights are refused with a message.
- The page never sends a path or command line; the main process looks everything up itself.

## Install and uninstall

Get one of these from the [Releases](../../releases) page:

- **Setup `.exe`:** installs the app for your user (you can choose the folder) and adds an uninstaller. Remove it from Windows' *Installed apps*.
- **Portable `.exe`:** runs without installing. To remove it, close the app and delete the file.
- **Zip:** the unpacked app. Unzip anywhere and run `Webase System Monitor.exe`; to remove it, delete the folder.

Settings are kept in a folder under `%APPDATA%`, and history, the activity list and logs in `%LOCALAPPDATA%\WebaseSystemMonitor`. By default the installer's uninstaller leaves them in place; delete those folders too if you want everything gone.

## Run from source

```powershell
npm install
node node_modules/electron/install.js
npm start
```

Tests: `npm run test:main` (Node tests for `electron/`), `npm test` (Angular), `npm run test:e2e` (the real window, about 3 minutes).

## Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org). *(Pending: this is the policy we are applying under. Releases are unsigned until SignPath approves the project.)*

- **Committers, reviewers and approvers:** the project owner, [zelda1511](https://github.com/zelda1511). Every release is built by the GitHub Actions workflow in `.github/workflows/release.yml` from this repository and must be approved by hand before it is signed.

## Privacy policy

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.

In practice: the app collects nothing and sends nothing. Everything it records (settings, the optional CPU and memory history) stays on your PC. When you ask it to update an app or a driver, Windows' own tools (`winget`, Windows Update) contact their servers, and driver vendor pages open in your browser only when you click them.
