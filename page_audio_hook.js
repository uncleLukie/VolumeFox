// main-world hook. routes web audio + media elements through a gain node.
(function() {
    'use strict';

    if (window.__volumeFoxHookInstalled) return;
    window.__volumeFoxHookInstalled = true;

    const MSG_SOURCE_CS = 'volumefox-cs';
    const MSG_TARGET_PAGE = 'volumefox-page';

    const state = {
        volume: 100,      // 0 to 600 (%)
        gain: 1.0,        // 0.0 to 6.0
        muted: false,
        debug: false
    };

    function effectiveGain() {
        if (state.muted) return 0.0;
        return Math.max(0.0, Math.min(6.0, state.volume / 100.0));
    }

    function isDefaultState() {
        return state.volume === 100 && !state.muted;
    }

    const boosterNodes = new WeakSet();
    const contextBoosterMap = new WeakMap();
    const trackedMediaElements = new Set();
    const mediaRoutes = new WeakMap();
    // base volume is what the page set. the hooked getter reports this back so the page doesn't see our scaling.
    const mediaBaseVolumes = new WeakMap();
    const mediaListenersAttached = new WeakSet();
    const routeFailed = new WeakSet();
    const corsTried = new WeakMap();
    const corsProbes = new Map();
    let sharedAudioContext = null;
    let volumeAccessorHooked = false;

    const AudioNodeProto = window.AudioNode && window.AudioNode.prototype;
    const nativeConnect = AudioNodeProto && AudioNodeProto.connect;
    const nativeDisconnect = AudioNodeProto && AudioNodeProto.disconnect;
    const MediaProto = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
    const nativePlay = MediaProto && MediaProto.play;
    const nativeVolumeDesc = MediaProto && Object.getOwnPropertyDescriptor(MediaProto, 'volume');
    const nativeVolumeGet = nativeVolumeDesc && nativeVolumeDesc.get;
    const nativeVolumeSet = nativeVolumeDesc && nativeVolumeDesc.set;
    const nativeAttachShadow = window.Element && window.Element.prototype && window.Element.prototype.attachShadow;
    const nativeCreateElement = window.Document && window.Document.prototype && window.Document.prototype.createElement;

    function log(...args) {
        if (state.debug) {
            console.log('[VolumeFox Hook]', ...args);
        }
    }

    function readNativeVolume(el) {
        return nativeVolumeGet ? nativeVolumeGet.call(el) : el.volume;
    }

    function writeNativeVolume(el, value) {
        if (nativeVolumeSet) {
            nativeVolumeSet.call(el, value);
        } else {
            el.volume = value;
        }
    }

    function getBaseVolume(el) {
        if (!mediaBaseVolumes.has(el)) {
            mediaBaseVolumes.set(el, readNativeVolume(el));
        }
        return mediaBaseVolumes.get(el);
    }

    function isOfflineContext(context) {
        if (!context) return false;
        return (typeof OfflineAudioContext !== 'undefined' && context instanceof OfflineAudioContext) ||
               (typeof webkitOfflineAudioContext !== 'undefined' && context instanceof webkitOfflineAudioContext);
    }

    function resumeSharedContext() {
        if (sharedAudioContext && sharedAudioContext.state === 'suspended') {
            sharedAudioContext.resume().catch(() => {});
        }
    }

    function getOrCreateBoosterGraph(context) {
        if (!context || isOfflineContext(context)) return null;
        if (contextBoosterMap.has(context)) {
            return contextBoosterMap.get(context);
        }

        try {
            const gainNode = context.createGain();
            const compressor = context.createDynamicsCompressor();

            compressor.threshold.value = -12;
            compressor.knee.value = 30;
            compressor.ratio.value = 12;
            compressor.attack.value = 0.003;
            compressor.release.value = 0.25;

            boosterNodes.add(gainNode);
            boosterNodes.add(compressor);

            gainNode.gain.value = effectiveGain();

            if (nativeConnect) {
                nativeConnect.call(gainNode, compressor);
                nativeConnect.call(compressor, context.destination);
            } else {
                gainNode.connect(compressor);
                compressor.connect(context.destination);
            }

            const graph = { gainNode, compressor, context };
            contextBoosterMap.set(context, graph);
            return graph;
        } catch (err) {
            log('Error creating booster graph for context:', err);
            return null;
        }
    }

    if (AudioNodeProto && nativeConnect) {
        AudioNodeProto.connect = function(destination, outputIndex, inputIndex) {
            try {
                if (destination && this.context && destination === this.context.destination && !boosterNodes.has(this) && !isOfflineContext(this.context)) {
                    const booster = getOrCreateBoosterGraph(this.context);
                    if (booster) {
                        log('Rerouting connection to VolumeFox booster graph');
                        if (outputIndex !== undefined) {
                            return nativeConnect.call(this, booster.gainNode, outputIndex, inputIndex || 0);
                        }
                        return nativeConnect.call(this, booster.gainNode);
                    }
                }
            } catch (err) {
                log('Error in connect interception:', err);
            }

            if (outputIndex !== undefined && inputIndex !== undefined) {
                return nativeConnect.call(this, destination, outputIndex, inputIndex);
            } else if (outputIndex !== undefined) {
                return nativeConnect.call(this, destination, outputIndex);
            }
            return nativeConnect.call(this, destination);
        };
    }

    if (AudioNodeProto && nativeDisconnect) {
        AudioNodeProto.disconnect = function(destination, outputIndex, inputIndex) {
            try {
                if (destination && this.context && destination === this.context.destination && !boosterNodes.has(this) && !isOfflineContext(this.context)) {
                    const booster = contextBoosterMap.get(this.context);
                    if (booster) {
                        if (destination !== undefined) {
                            return nativeDisconnect.call(this, booster.gainNode);
                        }
                    }
                }
            } catch (err) {
                log('Error in disconnect interception:', err);
            }

            if (destination !== undefined && outputIndex !== undefined && inputIndex !== undefined) {
                return nativeDisconnect.call(this, destination, outputIndex, inputIndex);
            } else if (destination !== undefined && outputIndex !== undefined) {
                return nativeDisconnect.call(this, destination, outputIndex);
            } else if (destination !== undefined) {
                return nativeDisconnect.call(this, destination);
            }
            return nativeDisconnect.call(this);
        };
    }

    function getSharedContext() {
        if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) {
                try {
                    sharedAudioContext = new AudioContextClass();
                } catch (e) {
                    log('Failed to create shared AudioContext:', e);
                }
            }
        }
        return sharedAudioContext;
    }

    function isRestrictedDRM(element) {
        if (element.mediaKeys || element.webkitKeys) return true;
        if (element.dataset && element.dataset.vfRestricted === 'true') return true;
        return false;
    }

    function mediaSrc(el) {
        return el.currentSrc || el.src || '';
    }

    // cross origin media that wasnt fetched with cors goes silent inside
    // createMediaElementSource, and that can't be undone. only route when it's safe.
    function isRoutable(el) {
        if (!el || el.error || routeFailed.has(el)) return false;
        const src = mediaSrc(el);
        if (!src) return false;

        let url;
        try {
            url = new URL(src, document.baseURI);
        } catch (e) {
            return false;
        }

        if (url.protocol === 'blob:' || url.protocol === 'data:' || url.protocol === 'mediastream:') return true;
        if (url.origin === location.origin) return true;
        // wait until the cors response is actually loaded, not just the attribute
        if (el.crossOrigin === 'anonymous' || el.crossOrigin === 'use-credentials') return el.readyState >= 2;
        return false;
    }

    function probeCors(src) {
        if (corsProbes.has(src)) return corsProbes.get(src);

        const pending = Promise.resolve().then(() => fetch(src, {
            method: 'GET',
            mode: 'cors',
            credentials: 'omit',
            cache: 'force-cache',
            headers: { Range: 'bytes=0-0' }
        })).then(res => {
            if (res.body && res.body.cancel) res.body.cancel().catch(() => {});
            return res.type === 'cors' && (res.ok || res.status === 206);
        }).catch(() => false);

        corsProbes.set(src, pending);
        return pending;
    }

    // if playback hasn't started and the server actually allows cors, opt in now.
    // flipping crossorigin on something already playing reloads it and firefox
    // usually won't let us resume play from the extension.
    function prepareCors(el) {
        const src = mediaSrc(el);
        if (!src || el.crossOrigin || corsTried.get(el) === src) return;
        if (el.readyState > 0 || el.currentTime > 0 || !el.paused) return;

        let url;
        try {
            url = new URL(src, document.baseURI);
        } catch (e) {
            return;
        }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
        if (url.origin === location.origin) return;

        corsTried.set(el, src);
        probeCors(src).then(ok => {
            if (!ok || mediaRoutes.has(el)) return;
            if (mediaSrc(el) !== src) return;
            if (el.readyState > 0 || el.currentTime > 0 || !el.paused || el.crossOrigin) return;
            try {
                el.crossOrigin = 'anonymous';
            } catch (e) {}
        });
    }

    function attachMediaElementBooster(element) {
        if (mediaRoutes.has(element)) return mediaRoutes.get(element);
        if (isRestrictedDRM(element)) {
            log('Skipping Web Audio routing due to DRM restrictions');
            return null;
        }
        if (!isRoutable(element)) {
            prepareCors(element);
            return null;
        }

        const ctx = getSharedContext();
        if (!ctx) return null;

        try {
            const source = ctx.createMediaElementSource(element);
            const gainNode = ctx.createGain();
            const compressor = ctx.createDynamicsCompressor();

            compressor.threshold.value = -12;
            compressor.knee.value = 30;
            compressor.ratio.value = 12;
            compressor.attack.value = 0.003;
            compressor.release.value = 0.25;

            boosterNodes.add(gainNode);
            boosterNodes.add(compressor);

            gainNode.gain.value = effectiveGain();

            if (nativeConnect) {
                nativeConnect.call(source, gainNode);
                nativeConnect.call(gainNode, compressor);
                nativeConnect.call(compressor, ctx.destination);
            } else {
                source.connect(gainNode);
                gainNode.connect(compressor);
                compressor.connect(ctx.destination);
            }

            const route = { ctx, source, gainNode, compressor };
            mediaRoutes.set(element, route);

            resumeSharedContext();

            log('Attached Web Audio booster to media element successfully');
            return route;
        } catch (err) {
            routeFailed.add(element);
            log('createMediaElementSource failed (already connected or CORS):', err);
            return null;
        }
    }

    // write the real volume, bypassing our getter/setter so it isn't recorded as a page change
    function setNativeVolume(element, value) {
        const clamped = Math.max(0.0, Math.min(1.0, value));
        try {
            if (Math.abs(readNativeVolume(element) - clamped) > 1e-4) {
                writeNativeVolume(element, clamped);
            }
        } catch (e) {
            log('Error setting element.volume:', e);
        }
    }

    function applyToMediaElement(element) {
        if (!element || !(element instanceof HTMLMediaElement)) return;

        const gain = effectiveGain();
        const base = getBaseVolume(element);
        let route = mediaRoutes.get(element);

        if (gain > 1.0 && !route && !isRestrictedDRM(element)) {
            route = attachMediaElementBooster(element);
        }

        if (route) {
            route.gainNode.gain.value = gain;
            setNativeVolume(element, base);
            if (gain > 0) resumeSharedContext();
        } else {
            setNativeVolume(element, base * Math.min(gain, 1.0));
        }
    }

    function applyState() {
        const targetGain = effectiveGain();

        if (targetGain > 0) {
            resumeSharedContext();
        }

        findMediaElements(document).forEach(trackMedia);

        for (const el of trackedMediaElements) {
            if (el.isConnected || !el.paused) {
                applyToMediaElement(el);
            }
        }
    }

    function trackMedia(el) {
        if (!el || !(el instanceof HTMLMediaElement)) return;
        if (trackedMediaElements.has(el)) {
            applyToMediaElement(el);
            return;
        }
        trackedMediaElements.add(el);
        getBaseVolume(el);

        if (mediaListenersAttached.has(el)) {
            applyToMediaElement(el);
            return;
        }
        mediaListenersAttached.add(el);

        el.addEventListener('emptied', () => routeFailed.delete(el));
        el.addEventListener('loadstart', () => {
            if (effectiveGain() > 1) applyToMediaElement(el);
        });
        el.addEventListener('loadeddata', () => {
            if (effectiveGain() > 1) applyToMediaElement(el);
        });

        el.addEventListener('play', () => {
            resumeSharedContext();
            applyToMediaElement(el);
        }, { passive: true });

        el.addEventListener('playing', () => {
            resumeSharedContext();
            applyToMediaElement(el);
        }, { passive: true });

        if (!volumeAccessorHooked) {
            // only used if the volume getter couldn't be hooked
            el.addEventListener('volumechange', () => {
                const native = readNativeVolume(el);
                const base = getBaseVolume(el);
                const route = mediaRoutes.get(el);
                const expected = route ? base : base * Math.min(effectiveGain(), 1.0);
                if (Math.abs(native - expected) > 1e-4) {
                    mediaBaseVolumes.set(el, native);
                    applyToMediaElement(el);
                }
            }, { passive: true });
        }

        applyToMediaElement(el);
    }

    // page reads/writes its own volume. without this our writes get treated as page changes
    // and lowering compounds every time.
    if (MediaProto && nativeVolumeGet && nativeVolumeSet && nativeVolumeDesc.configurable) {
        try {
            Object.defineProperty(MediaProto, 'volume', {
                configurable: true,
                enumerable: nativeVolumeDesc.enumerable,
                get() {
                    if (mediaBaseVolumes.has(this)) return mediaBaseVolumes.get(this);
                    return nativeVolumeGet.call(this);
                },
                set(value) {
                    nativeVolumeSet.call(this, value);
                    mediaBaseVolumes.set(this, nativeVolumeGet.call(this));
                    if (trackedMediaElements.has(this)) {
                        applyToMediaElement(this);
                    }
                }
            });
            volumeAccessorHooked = true;
        } catch (e) {
            log('Could not hook HTMLMediaElement.volume:', e);
        }
    }

    function findMediaElements(root = document, found = new Set()) {
        if (!root) return found;
        try {
            if (root.querySelectorAll) {
                root.querySelectorAll('video, audio').forEach(el => found.add(el));
                root.querySelectorAll('*').forEach(el => {
                    if (el.shadowRoot) {
                        findMediaElements(el.shadowRoot, found);
                    }
                });
            }
        } catch (_) {}
        return found;
    }

    if (nativePlay) {
        window.HTMLMediaElement.prototype.play = function() {
            try {
                trackMedia(this);
                resumeSharedContext();
            } catch (_) {}
            return nativePlay.apply(this, arguments);
        };
    }

    if (nativeAttachShadow) {
        Element.prototype.attachShadow = function() {
            const shadowRoot = nativeAttachShadow.apply(this, arguments);
            try {
                findMediaElements(shadowRoot).forEach(trackMedia);

                if (typeof MutationObserver !== 'undefined') {
                    const shadowObserver = new MutationObserver(mutations => {
                        for (const mut of mutations) {
                            for (const node of mut.addedNodes) {
                                if (node.nodeType === Node.ELEMENT_NODE) {
                                    if (node.matches && node.matches('video, audio')) trackMedia(node);
                                    if (node.querySelectorAll) findMediaElements(node).forEach(trackMedia);
                                }
                            }
                        }
                    });
                    shadowObserver.observe(shadowRoot, { childList: true, subtree: true });
                }
            } catch (_) {}
            return shadowRoot;
        };
    }

    if (nativeCreateElement) {
        window.Document.prototype.createElement = function(tagName) {
            const el = nativeCreateElement.apply(this, arguments);
            if (typeof tagName === 'string') {
                const tag = tagName.toLowerCase();
                if (tag === 'video' || tag === 'audio') {
                    trackMedia(el);
                }
            }
            return el;
        };
    }

    findMediaElements(document).forEach(trackMedia);

    const observer = new MutationObserver(mutations => {
        for (const mut of mutations) {
            for (const node of mut.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.matches && node.matches('video, audio')) {
                        trackMedia(node);
                    }
                    if (node.querySelectorAll) {
                        findMediaElements(node).forEach(trackMedia);
                    }
                }
            }
        }
    });

    const startObserving = () => {
        const root = document.documentElement || document.body;
        if (root) observer.observe(root, { childList: true, subtree: true });
        findMediaElements(document).forEach(trackMedia);
    };

    if (document.documentElement) {
        startObserving();
    } else {
        document.addEventListener('DOMContentLoaded', startObserving, { once: true });
    }

    // catch players that show up late (reddit feed etc). skip the walk while we're at 100%.
    setInterval(() => {
        for (const el of trackedMediaElements) {
            if (!el.isConnected && el.paused) trackedMediaElements.delete(el);
        }
        if (isDefaultState()) return;
        findMediaElements(document).forEach(trackMedia);
    }, 2000);

    ['pointerdown', 'keydown', 'click'].forEach(evt => {
        document.addEventListener(evt, resumeSharedContext, { passive: true, capture: true });
    });

    window.addEventListener('message', event => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.source !== MSG_SOURCE_CS || data.target !== MSG_TARGET_PAGE) return;

        switch (data.action) {
            case 'setVolume':
                if (typeof data.volume === 'number') {
                    state.volume = Math.max(0, Math.min(600, data.volume));
                    state.gain = state.volume / 100.0;
                }
                if (typeof data.muted === 'boolean') {
                    state.muted = data.muted;
                }
                applyState();
                window.postMessage({
                    source: MSG_TARGET_PAGE,
                    target: MSG_SOURCE_CS,
                    action: 'stateUpdated',
                    volume: state.volume,
                    gain: state.gain,
                    muted: state.muted
                }, '*');
                break;

            case 'getVolume':
                window.postMessage({
                    source: MSG_TARGET_PAGE,
                    target: MSG_SOURCE_CS,
                    action: 'stateReport',
                    volume: state.volume,
                    gain: state.gain,
                    muted: state.muted
                }, '*');
                break;
        }
    });

    log('hook installed');
})();
