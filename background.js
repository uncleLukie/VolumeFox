/**
 * VolumeFox - Background Script
 * Manifest V3 background script managing per-tab volume states, badge display, and audible tab querying.
 */
(function() {
    'use strict';

    const api = typeof browser !== 'undefined' ? browser : chrome;

    // Per-tab state: Map<tabId, { volume: number, muted: boolean }>
    const tabStates = new Map();

    function getTabState(tabId) {
        if (!tabStates.has(tabId)) {
            tabStates.set(tabId, { volume: 100, muted: false });
        }
        return tabStates.get(tabId);
    }

    function updateBadge(tabId, state) {
        if (!api.action) return;

        try {
            if (state.muted) {
                api.action.setBadgeText({ text: 'MUT', tabId });
                api.action.setBadgeBackgroundColor({ color: '#ef4444', tabId });
            } else if (state.volume > 100) {
                api.action.setBadgeText({ text: `${state.volume}%`, tabId });
                api.action.setBadgeBackgroundColor({ color: '#32bea6', tabId }); // VolumeFox Teal
            } else if (state.volume < 100) {
                api.action.setBadgeText({ text: `${state.volume}%`, tabId });
                api.action.setBadgeBackgroundColor({ color: '#6b7280', tabId });
            } else {
                api.action.setBadgeText({ text: '', tabId });
            }
        } catch (e) {
            console.error('[VolumeFox BG] Badge error:', e);
        }
    }

    // Clean up closed tabs
    api.tabs.onRemoved.addListener((tabId) => {
        tabStates.delete(tabId);
    });

    // Message router
    api.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message || !message.action) return false;

        // When content script initializes and asks for initial state
        if (message.action === 'getTabInitialState') {
            const tabId = sender.tab ? sender.tab.id : null;
            if (tabId != null) {
                const state = getTabState(tabId);
                sendResponse(state);
            } else {
                sendResponse({ volume: 100, muted: false });
            }
            return false;
        }

        // Set volume for a specific tab (or active tab if not specified)
        if (message.action === 'setVolume') {
            const targetTabId = message.tabId;
            const vol = parseFloat(message.volume);
            const muted = typeof message.muted === 'boolean' ? message.muted : undefined;

            const applyToTab = (tabId) => {
                const state = getTabState(tabId);
                if (!isNaN(vol)) state.volume = Math.max(0, Math.min(600, vol));
                if (muted !== undefined) state.muted = muted;
                updateBadge(tabId, state);

                api.tabs.sendMessage(tabId, {
                    action: 'setVolume',
                    volume: state.volume,
                    muted: state.muted
                }).then(resp => {
                    sendResponse(resp || { success: true, volume: state.volume, muted: state.muted });
                }).catch(() => {
                    sendResponse({ success: true, volume: state.volume, muted: state.muted });
                });
            };

            if (targetTabId != null) {
                applyToTab(targetTabId);
                return true;
            } else {
                api.tabs.query({ active: true, currentWindow: true }).then(tabs => {
                    if (tabs.length > 0) {
                        applyToTab(tabs[0].id);
                    } else {
                        sendResponse({ success: false, error: 'No active tab found' });
                    }
                }).catch(err => {
                    sendResponse({ success: false, error: err.message });
                });
                return true;
            }
        }

        // Toggle or set mute
        if (message.action === 'setMute') {
            const targetTabId = message.tabId;

            const applyMute = (tabId) => {
                const state = getTabState(tabId);
                if (typeof message.muted === 'boolean') {
                    state.muted = message.muted;
                } else {
                    state.muted = !state.muted;
                }
                updateBadge(tabId, state);

                api.tabs.sendMessage(tabId, {
                    action: 'setMute',
                    muted: state.muted
                }).then(resp => {
                    sendResponse(resp || { success: true, muted: state.muted });
                }).catch(() => {
                    sendResponse({ success: true, muted: state.muted });
                });
            };

            if (targetTabId != null) {
                applyMute(targetTabId);
                return true;
            } else {
                api.tabs.query({ active: true, currentWindow: true }).then(tabs => {
                    if (tabs.length > 0) {
                        applyMute(tabs[0].id);
                    } else {
                        sendResponse({ success: false, error: 'No active tab found' });
                    }
                }).catch(err => {
                    sendResponse({ success: false, error: err.message });
                });
                return true;
            }
        }

        // Get state for a tab
        if (message.action === 'getVolume') {
            const targetTabId = message.tabId;
            if (targetTabId != null) {
                sendResponse(getTabState(targetTabId));
                return false;
            } else {
                api.tabs.query({ active: true, currentWindow: true }).then(tabs => {
                    if (tabs.length > 0) {
                        sendResponse(getTabState(tabs[0].id));
                    } else {
                        sendResponse({ volume: 100, muted: false });
                    }
                });
                return true;
            }
        }

        // Get all tabs playing audio
        if (message.action === 'getAudibleTabs') {
            api.tabs.query({ audible: true }).then(tabs => {
                const result = tabs.map(t => {
                    const st = getTabState(t.id);
                    return {
                        id: t.id,
                        title: t.title || 'Untitled Tab',
                        url: t.url,
                        favIconUrl: t.favIconUrl,
                        volume: st.volume,
                        muted: st.muted
                    };
                });
                sendResponse({ tabs: result });
            }).catch(err => {
                sendResponse({ tabs: [], error: err.message });
            });
            return true;
        }

        return false;
    });

    console.log('[VolumeFox] Background script initialized');
})();
