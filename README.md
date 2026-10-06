# volumefox

a simple foss firefox extension to boost audio in tabs up to 600%.

unlike chrome which has `tabcapture`, firefox doesnt have an easy api for this so older extensions broke on cors or wierd site setups. this uses a main-world hook to intercept web audio and media elements cleanly.

## architecture

- `page_audio_hook.js`: runs in `world: "main"` at `document_start`. hooks into `audionode.prototype.connect` and `htmlmediaelement` so web audio / synthesizers / youtube / reddit shadow dom players get routed through a gain node + dynamic compressor (so it doesnt clip into ear rape). also hooks the `volume` accessor so the page keeps seeing its own volume while volumefox scales underneath it. cross origin files only get that boost if they were loaded with cors, otherwise there left at normal volume so they dont go silent.
- `content_script.js`: runs in isolated world, relays messages between popup/background and teh page hook via `window.postmessage`.
- `background.js`: mv3 event page. tracks per-tab volume + badge text, mirrored into `storage.session` so state survives firefox suspending the background script. also handles keyboard shortcuts.
- `popup/`: the little popup ui to drag the slider, mute, or pick another audible tab to control.

## keyboard shortcuts

| shortcut | action |
| --- | --- |
| `alt+shift+up` | volume up 10% |
| `alt+shift+down` | volume down 10% |
| `alt+shift+m` | mute / unmute |
| (unassigned) | reset to 100% |

change them in `about:addons` → gear → manage extension shortcuts (or the "keyboard shortcuts" link in the popup footer).

## permissions

- `<all_urls>` host permission: the audio hook has to be injected into every page/frame that might play sound.
- `tabs`: read tab titles/favicons for the "tabs playing audio" list.
- `storage`: `storage.session` for per-tab volume state (nothing leaves the browser, no data collection).

## how to intall (for devs)

1. clone repo
2. open firefox and go to `about:debugging#/runtime/this-firefox`
3. click "load temporary add-on..." and pick `manifest.json` in this folder

or if u prefer cli:
```bash
npm install
npm run build
npm start
```

## license

mit
