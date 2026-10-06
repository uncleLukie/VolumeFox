// per-tab volume, badge and shortcuts.
// storage.session so state survives the event page getting suspended.
(function() {
    'use strict';

    const api = typeof browser !== 'undefined' ? browser : chrome;

    const MIN_VOLUME = 0;
    const MAX_VOLUME = 600;
    const COMMAND_STEP = 10;
    const STORAGE_KEY = 'tabStates';

    const BADGE_COLOR_MUTED = '#ef4444';
    const BADGE_COLOR_BOOSTED = '#32bea6'; // VolumeFox teal
    const BADGE_COLOR_QUIET = '#6b7280';

    let tabStates = null;
    let loadPromise = null;
    let saveTimer = null;

    function clampVolume(vol) {
        return Math.max(MIN_VOLUME, Math.min(MAX_VOLUME, vol));
    }

    function defaultState() {
        return { volume: 100, muted: false };
    }

    function isDefaultState(state) {
        return state.volume === 100 && !state.muted;
    }

    function sanitizeState(raw) {
        const state = defaultState();
        if (raw && typeof raw === 'object') {
            const vol = parseFloat(raw.volume);
            if (!isNaN(vol)) state.volume = clampVolume(vol);
            state.muted = !!raw.muted;
        }
        return state;
    }

    function storageArea() {
        if (!api.storage) return null;
        return api.storage.session || null;
    }

    function loadStates() {
        if (tabStates) return Promise.resolve(tabStates);
        if (loadPromise) return loadPromise;

        loadPromise = (async () => {
            const map = new Map();
            const area = storageArea();
            if (area) {
                try {
                    const data = await area.get(STORAGE_KEY);
                    const saved = data && data[STORAGE_KEY];
                    if (saved && typeof saved === 'object') {
                        for (const [id, raw] of Object.entries(saved)) {
                            const tabId = Number(id);
                            if (Number.isInteger(tabId)) map.set(tabId, sanitizeState(raw));
                        }
                    }
                } catch (e) {
                    console.warn('[VolumeFox BG] Could not restore tab states:', e);
                }
            }
            tabStates = map;
            return map;
        })();

        return loadPromise;
    }

    function persistStates() {
        const area = storageArea();
        if (!area || !tabStates) return Promise.resolve();

        const serialised = {};
        for (const [tabId, state] of tabStates) {
            if (!isDefaultState(state)) serialised[tabId] = state;
        }
        return area.set({ [STORAGE_KEY]: serialised }).catch(e => {
            console.warn('[VolumeFox BG] Could not persist tab states:', e);
        });
    }

    function schedulePersist() {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            persistStates();
        }, 50);
    }

    async function getTabState(tabId) {
        const states = await loadStates();
        if (!states.has(tabId)) {
            states.set(tabId, defaultState());
        }
        return states.get(tabId);
    }

    function updateBadge(tabId, state) {
        if (!api.action) return;

        try {
            if (state.muted) {
                api.action.setBadgeText({ text: 'MUT', tabId });
                api.action.setBadgeBackgroundColor({ color: BADGE_COLOR_MUTED, tabId });
            } else if (state.volume > 100) {
                api.action.setBadgeText({ text: `${Math.round(state.volume)}%`, tabId });
                api.action.setBadgeBackgroundColor({ color: BADGE_COLOR_BOOSTED, tabId });
            } else if (state.volume < 100) {
                api.action.setBadgeText({ text: `${Math.round(state.volume)}%`, tabId });
                api.action.setBadgeBackgroundColor({ color: BADGE_COLOR_QUIET, tabId });
            } else {
                api.action.setBadgeText({ text: '', tabId });
            }
        } catch (e) {
            console.error('[VolumeFox BG] Badge error:', e);
        }
    }

    async function pushStateToTab(tabId, state) {
        try {
            return await api.tabs.sendMessage(tabId, {
                action: 'setVolume',
                volume: state.volume,
                muted: state.muted
            });
        } catch (_) {
            return null;
        }
    }

    async function applyVolume(tabId, volume, muted) {
        const state = await getTabState(tabId);
        const vol = parseFloat(volume);
        if (!isNaN(vol)) state.volume = clampVolume(vol);
        if (typeof muted === 'boolean') state.muted = muted;

        updateBadge(tabId, state);
        schedulePersist();
        await pushStateToTab(tabId, state);

        return { success: true, volume: state.volume, muted: state.muted };
    }

    async function applyMute(tabId, muted) {
        const state = await getTabState(tabId);
        state.muted = typeof muted === 'boolean' ? muted : !state.muted;

        updateBadge(tabId, state);
        schedulePersist();
        await pushStateToTab(tabId, state);

        return { success: true, volume: state.volume, muted: state.muted };
    }

    async function resolveTabId(explicitTabId) {
        if (explicitTabId != null) return explicitTabId;
        const tabs = await api.tabs.query({ active: true, currentWindow: true });
        if (!tabs.length) throw new Error('No active tab found');
        return tabs[0].id;
    }

    // muted tabs dissapear from the audible query, so keep any tab we've adjusted too
    async function getManagedTabs() {
        const states = await loadStates();
        const audible = await api.tabs.query({ audible: true });
        const byId = new Map(audible.map(t => [t.id, t]));

        const adjustedIds = [];
        for (const [tabId, state] of states) {
            if (!isDefaultState(state) && !byId.has(tabId)) adjustedIds.push(tabId);
        }

        await Promise.all(adjustedIds.map(async tabId => {
            try {
                byId.set(tabId, await api.tabs.get(tabId));
            } catch (_) {
                states.delete(tabId);
                schedulePersist();
            }
        }));

        const result = [];
        for (const tab of byId.values()) {
            const st = states.get(tab.id) || defaultState();
            result.push({
                id: tab.id,
                title: tab.title || 'Untitled Tab',
                url: tab.url,
                favIconUrl: tab.favIconUrl,
                audible: !!tab.audible,
                volume: st.volume,
                muted: st.muted
            });
        }

        result.sort((a, b) => (a.audible === b.audible ? a.id - b.id : (a.audible ? -1 : 1)));
        return result;
    }

    async function handleMessage(message, sender) {
        switch (message.action) {
            case 'getTabInitialState': {
                const tabId = sender.tab ? sender.tab.id : null;
                if (tabId == null) return defaultState();
                return { ...(await getTabState(tabId)) };
            }

            case 'setVolume': {
                const tabId = await resolveTabId(message.tabId);
                return applyVolume(tabId, message.volume, message.muted);
            }

            case 'setMute': {
                const tabId = await resolveTabId(message.tabId);
                return applyMute(tabId, message.muted);
            }

            case 'getVolume': {
                const tabId = await resolveTabId(message.tabId);
                return { ...(await getTabState(tabId)) };
            }

            case 'getAudibleTabs':
                return { tabs: await getManagedTabs() };

            default:
                return undefined;
        }
    }

    api.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message || !message.action) return false;

        handleMessage(message, sender).then(
            result => sendResponse(result),
            err => sendResponse({ success: false, error: err && err.message ? err.message : String(err) })
        );
        return true;
    });

    api.tabs.onRemoved.addListener(tabId => {
        loadStates().then(states => {
            if (states.delete(tabId)) schedulePersist();
        });
    });

    if (api.commands && api.commands.onCommand) {
        api.commands.onCommand.addListener(async command => {
            try {
                const tabId = await resolveTabId(null);
                const state = await getTabState(tabId);

                switch (command) {
                    case 'volume-up':
                        await applyVolume(tabId, snapToStep(state.volume + COMMAND_STEP), false);
                        break;
                    case 'volume-down':
                        await applyVolume(tabId, snapToStep(state.volume - COMMAND_STEP), false);
                        break;
                    case 'toggle-mute':
                        await applyMute(tabId);
                        break;
                    case 'reset-volume':
                        await applyVolume(tabId, 100, false);
                        break;
                }
            } catch (e) {
                console.error('[VolumeFox BG] Command failed:', command, e);
            }
        });
    }

    function snapToStep(vol) {
        return clampVolume(Math.round(vol / COMMAND_STEP) * COMMAND_STEP);
    }

    loadStates();
})();
