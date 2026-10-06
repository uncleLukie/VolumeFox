// relays messages between the extension and the page hook
(function() {
    'use strict';

    if (window.__volumeFoxCSInstalled) return;
    window.__volumeFoxCSInstalled = true;

    const MSG_SOURCE_CS = 'volumefox-cs';
    const MSG_TARGET_PAGE = 'volumefox-page';

    let currentVolume = 100;
    let currentMuted = false;

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

    function syncToPage() {
        postToPage('setVolume', {
            volume: currentVolume,
            muted: currentMuted
        });
    }

    window.addEventListener('message', event => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.source !== MSG_TARGET_PAGE || data.target !== MSG_SOURCE_CS) return;

        if (data.action === 'stateUpdated' || data.action === 'stateReport') {
            if (typeof data.volume === 'number') currentVolume = data.volume;
            if (typeof data.muted === 'boolean') currentMuted = data.muted;
        }
    });

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

    try {
        Promise.resolve(api.runtime.sendMessage({ action: 'getTabInitialState' }))
            .then(response => {
                if (response && typeof response.volume === 'number') {
                    currentVolume = response.volume;
                    currentMuted = !!response.muted;
                    syncToPage();
                }
            })
            .catch(() => {});
    } catch (_) {}

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', syncToPage, { once: true });
    } else {
        syncToPage();
    }
})();
