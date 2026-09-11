/**
 * VolumeFox - Content Script (Isolated World)
 * Runs at document_start in all frames.
 * Relays messages between popup/background and the MAIN world page_audio_hook.
 */
(function() {
    'use strict';

    if (window.__volumeFoxCSInstalled) return;
    window.__volumeFoxCSInstalled = true;

    const MSG_SOURCE_CS = 'volumefox-cs';
    const MSG_TARGET_PAGE = 'volumefox-page';

    let currentVolume = 100;
    let currentMuted = false;

    // Cross-browser runtime API wrapper
    const api = typeof browser !== 'undefined' ? browser : chrome;

    function postToPage(action, payload = {}) {
        try {
            window.postMessage({
                source: MSG_SOURCE_CS,
                target: MSG_TARGET_PAGE,
                action,
                ...payload
            }, '*');
        } catch (e) {
            console.error('[VolumeFox CS] PostMessage error:', e);
        }
    }

    // Sync volume to page hook
    function syncToPage() {
        postToPage('setVolume', {
            volume: currentVolume,
            muted: currentMuted
        });
    }

    // Listen for replies from page_audio_hook.js
    window.addEventListener('message', event => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.source !== MSG_TARGET_PAGE || data.target !== MSG_SOURCE_CS) return;

        if (data.action === 'stateUpdated' || data.action === 'stateReport') {
            if (typeof data.volume === 'number') currentVolume = data.volume;
            if (typeof data.muted === 'boolean') currentMuted = data.muted;
        }
    });

    // Listen for extension messages (from popup or background)
    api.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message || !message.action) return false;

        switch (message.action) {
            case 'ping':
                sendResponse({ success: true, alive: true });
                return false;

            case 'getVolume':
                sendResponse({
                    success: true,
                    volume: currentVolume,
                    muted: currentMuted
                });
                return false;

            case 'setVolume': {
                const vol = parseFloat(message.volume);
                if (!isNaN(vol)) {
                    currentVolume = Math.max(0, Math.min(600, vol));
                }
                if (typeof message.muted === 'boolean') {
                    currentMuted = message.muted;
                }
                syncToPage();
                sendResponse({
                    success: true,
                    volume: currentVolume,
                    muted: currentMuted
                });
                return false;
            }

            case 'setMute': {
                if (typeof message.muted === 'boolean') {
                    currentMuted = message.muted;
                } else {
                    currentMuted = !currentMuted;
                }
                syncToPage();
                sendResponse({
                    success: true,
                    volume: currentVolume,
                    muted: currentMuted
                });
                return false;
            }
        }
        return false;
    });

    // Ask background for the active tab's stored volume on initial load
    try {
        api.runtime.sendMessage({ action: 'getTabInitialState' }, response => {
            if (api.runtime.lastError) return;
            if (response && typeof response.volume === 'number') {
                currentVolume = response.volume;
                currentMuted = !!response.muted;
                syncToPage();
            }
        });
    } catch (_) {}

    // Resync once DOM is interactive / loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', syncToPage, { once: true });
    } else {
        syncToPage();
    }
})();
