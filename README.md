# Pose Studio

Pose Studio is a 3D animation editor for the Unreal Engine 5 Manny rig. It runs in the browser, as an installable offline web app, as a Windows desktop app and as an Android tablet app.

**Live app:** https://iirg4x.github.io/pose-studio/

## What it does

- Pose Manny with IK/FK limbs, attachments, props and a camera.
- Animate with a dope sheet and a graph editor side by side, plus animation layers and live mirroring.
- Reset any control to the skeleton's real rest pose.
- Retarget animations onto other characters, and export to Unreal (desktop app).
- Record animations to video.

Projects stay on your device: in browser storage, or in `.pose` files you save yourself.

## Development

Requires Node.js 22.

For interface changes, follow the [UI rule book](docs/UI_RULEBOOK.md) and its
[interactive visual reference](docs/ui-rulebook.html). They define the shared
geometry, joined controls, surfaces, desktop conventions and responsive behavior.

```bash
npm ci
npm run dev
```

| Command               | What it does                                                 |
| --------------------- | ------------------------------------------------------------ |
| `npm run dev`         | Start the Vite dev server                                    |
| `npm test`            | Run the test suite (Vitest)                                  |
| `npm run typecheck`   | Type-check the app and tests                                 |
| `npm run lint:unused` | Find unused files, exports and dependencies (knip)           |
| `npm run format`      | Format with Prettier (`format:check` to verify)              |
| `npm run build:pwa`   | Build the installable web app into `dist-pwa/`               |
| `npm run package`     | Build the Windows desktop app (needs Blender for FBX export) |
| `npm run android:apk` | Build the Android APK (needs the Android SDK)                |

Every push to `main` runs the checks and tests, then deploys the web app to GitHub Pages.

## Code layout

| Path             | Contents                                                       |
| ---------------- | -------------------------------------------------------------- |
| `src/core`       | Animation model, keys and curves, layers, store (no rendering) |
| `src/scene`      | three.js scene, Manny rig, IK, attachments, retargeting        |
| `src/components` | React UI: desktop workspace, timeline, graph editor, panels    |
| `src/platform`   | Browser, Android and desktop storage and file access           |
| `shared`         | Project file codec and the web app build plugin                |
| `electron`       | Desktop app main process                                       |
| `android`        | Capacitor Android project                                      |
| `backend`        | Blender scripts for FBX import and export                      |
| `tests`          | Vitest suites, including tests against the real Manny rig      |
| `docs`           | Android and Unreal setup, QA reports                           |

See [CHANGELOG.md](CHANGELOG.md) for release notes.

## License

Pose Studio is free software under the [GNU General Public License v3.0 or later](LICENSE). You can use, study, change and share it; versions you distribute must stay under the GPL.

The license covers this project's code. Bundled third-party libraries keep their own licenses, and the Epic Games Manny model and other bundled assets remain the property of their owners. See [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt).
