/**
 * VolumeFox - Page Audio Hook
 * Executes in "world": "MAIN" at "run_at": "document_start"
 * 
 * Supports standard DOM, Web Components, and Shadow DOM (Reddit, Lit, etc.),
 * intercepts Web Audio API graphs, and boosts media elements with anti-clipping dynamics compression.
 */
(function() {
    'use strict';

    if (window.__volumeFoxHookInstalled) return;
    window.__volumeFoxHookInstalled = true;

    const MSG_SOURCE_CS = 'volumefox-cs';
    const MSG_TARGET_PAGE = 'volumefox-page';

    // State
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

    // Tracking
    const boosterNodes = new WeakSet();
    const contextBoosterMap = new WeakMap();
    const trackedMediaElements = new Set();
    const mediaRoutes = new WeakMap();
    const mediaBaseVolumes = new WeakMap();
    let sharedAudioContext = null;

    // Preserve native prototypes
    const AudioNodeProto = window.AudioNode && window.AudioNode.prototype;
    const nativeConnect = AudioNodeProto && AudioNodeProto.connect;
    const nativeDisconnect = AudioNodeProto && AudioNodeProto.disconnect;
    const nativePlay = window.HTMLMediaElement && window.HTMLMediaElement.prototype && window.HTMLMediaElement.prototype.play;
    const nativeAttachShadow = window.Element && window.Element.prototype && window.Element.prototype.attachShadow;
    const nativeCreateElement = window.Document && window.Document.prototype && window.Document.prototype.createElement;

    function log(...args) {
        if (state.debug) {
            console.log('[VolumeFox Hook]', ...args);
        }
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

    /**
     * Create or retrieve a booster graph (Gain + Compressor) for an AudioContext.
     */
    function getOrCreateBoosterGraph(context) {
        if (!context || isOfflineContext(context)) return null;
        if (contextBoosterMap.has(context)) {
            return contextBoosterMap.get(context);
        }

        try {
            const gainNode = context.createGain();
            const compressor = context.createDynamicsCompressor();

            // Anti-clipping limiter settings
            compressor.threshold.value = -12; // dB
            compressor.knee.value = 30;
            compressor.ratio.value = 12;
            compressor.attack.value = 0.003;  // 3ms
            compressor.release.value = 0.25;  // 250ms

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

    /**
     * Intercept AudioNode.prototype.connect:
     * When any page node connects to context.destination, redirect to our booster gain node!
     */
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

    /**
     * Intercept AudioNode.prototype.disconnect:
     */
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

    /**
     * Shared AudioContext for HTMLMediaElements when boosted > 100%
     */
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

    /**
     * Attach Web Audio booster to an HTMLMediaElement
     */
    function attachMediaElementBooster(element) {
        if (mediaRoutes.has(element)) return mediaRoutes.get(element);
        if (isRestrictedDRM(element)) {
            log('Skipping Web Audio routing due to DRM restrictions');
            return null;
        }

        // On Reddit (v.redd.it) and other CDN-hosted videos that provide CORS,
        // ensure crossOrigin is set if needed so Web Audio doesn't mute
        if (!element.crossOrigin && element.src && (element.src.includes('v.redd.it') || element.src.includes('redditmedia.com'))) {
            try {
                element.crossOrigin = 'anonymous';
            } catch (_) {}
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
            log('createMediaElementSource failed (already connected or CORS):', err);
            return null;
        }
    }

    /**
     * Apply current volume / gain to a single media element
     */
    function applyToMediaElement(element) {
        if (!element || !(element instanceof HTMLMediaElement)) return;

        if (!mediaBaseVolumes.has(element)) {
            mediaBaseVolumes.set(element, element.volume > 0 ? element.volume : 1.0);
        }

        const gain = effectiveGain();

        // If muted
        if (state.muted) {
            element.muted = true;
            element.dataset.vfMutedByUs = 'true';
            return;
        } else {
            if (element.muted && element.dataset.vfMutedByUs === 'true') {
                element.muted = false;
                delete element.dataset.vfMutedByUs;
            }
        }

        // If volume <= 100%, prefer native volume scaling
        if (gain <= 1.0) {
            const route = mediaRoutes.get(element);
            if (route) {
                route.gainNode.gain.value = gain;
            } else {
                try {
                    const base = mediaBaseVolumes.get(element) ?? 1.0;
                    element.volume = Math.max(0.0, Math.min(1.0, base * gain));
                } catch (e) {
                    log('Error setting element.volume:', e);
                }
            }
        } else {
            // Volume > 100% (Boosting)
            if (isRestrictedDRM(element)) {
                element.volume = 1.0;
            } else {
                const route = attachMediaElementBooster(element);
                if (route) {
                    route.gainNode.gain.value = gain;
                    resumeSharedContext();
                } else {
                    element.volume = 1.0;
                }
            }
        }
    }

    /**
     * Apply current state across all contexts and media elements
     */
    function applyState() {
        const targetGain = effectiveGain();

        if (targetGain > 0) {
            resumeSharedContext();
        }

        // Scan everywhere (including Shadow DOMs) and apply
        findMediaElements(document).forEach(trackMedia);

        for (const el of trackedMediaElements) {
            if (el.isConnected || !el.paused) {
                applyToMediaElement(el);
            }
        }
    }

    // Register media element
    function trackMedia(el) {
        if (!el || !(el instanceof HTMLMediaElement)) return;
        if (trackedMediaElements.has(el)) {
            applyToMediaElement(el);
            return;
        }
        trackedMediaElements.add(el);

        if (!mediaBaseVolumes.has(el)) {
            mediaBaseVolumes.set(el, el.volume > 0 ? el.volume : 1.0);
        }

        el.addEventListener('play', () => {
            resumeSharedContext();
            applyToMediaElement(el);
        }, { passive: true });

        el.addEventListener('playing', () => {
            resumeSharedContext();
            applyToMediaElement(el);
        }, { passive: true });

        el.addEventListener('volumechange', () => {
            if (effectiveGain() <= 1.0 && !state.muted && el.volume > 0) {
                mediaBaseVolumes.set(el, el.volume);
            }
        }, { passive: true });

        applyToMediaElement(el);
    }

    /**
     * Deep Recursive Media Element Finder (Pierces Shadow DOM!)
     */
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

    /**
     * Hook HTMLMediaElement.prototype.play:
     * Guarantees that ANY video or audio that begins playback on Reddit or anywhere
     * is instantly caught and tracked, even inside Shadow DOM or custom Web Components!
     */
    if (nativePlay) {
        window.HTMLMediaElement.prototype.play = function() {
            try {
                trackMedia(this);
                resumeSharedContext();
            } catch (_) {}
            return nativePlay.apply(this, arguments);
        };
    }

    /**
     * Hook Element.prototype.attachShadow:
     * When Web Components (like Reddit's <shreddit-player>) create shadow roots,
     * immediately observe and scan them for media elements!
     */
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

    /**
     * Hook Document.prototype.createElement for dynamically created audio/video elements
     */
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

    // Scan initial DOM and Shadow DOMs
    findMediaElements(document).forEach(trackMedia);

    // Observe document mutations
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

    // Periodic sweep every 2 seconds for infinitely scrolling feeds (Reddit feed, etc.)
    setInterval(() => {
        findMediaElements(document).forEach(trackMedia);
    }, 2000);

    // User gesture listeners to resume AudioContext cleanly
    ['pointerdown', 'keydown', 'click'].forEach(evt => {
        document.addEventListener(evt, resumeSharedContext, { passive: true, capture: true });
    });

    // Bridge with content script
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

    log('VolumeFox MAIN world audio hook initialized with Shadow DOM & Web Component support');
})();
