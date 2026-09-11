# volumefox

a simple foss firefox extension to boost audio in tabs up to 600%.

unlike chrome which has `tabcapture`, firefox doesnt have an easy api for this so older extensions broke on cors or wierd site setups. this uses a main-world hook to intercept web audio and media elements cleanly.

## architecture

- `page_audio_hook.js`: runs in `world: "main"` at `document_start`. hooks into `audionode.prototype.connect` and `htmlmediaelement` so web audio / synthesizers / youtube / reddit shadow dom players get routed through a gain node + dynamic compressor (so it doesnt clip into ear rape).
- `content_script.js`: runs in isolated world, relays messages between popup/background and teh page hook via `window.postmessage`.
- `background.js`: tracks per-tab volume and badge text in memory / storage.
- `popup/`: the little popup ui to drag the slider, mute, or click audible tabs.

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
