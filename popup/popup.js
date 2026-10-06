document.addEventListener('DOMContentLoaded', async function() {
    'use strict';

    const api = typeof browser !== 'undefined' ? browser : chrome;

    const volumeSlider = document.getElementById('volumeSlider');
    const volumeValue = document.getElementById('volumeValue');
    const volumeDb = document.getElementById('volumeDb');
    const volumeBadge = document.getElementById('volumeBadge');
    const volumeCard = document.querySelector('.volume-card');
    const muteBtn = document.getElementById('muteBtn');
    const muteIcon = document.getElementById('muteIcon');
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    const themeIcon = document.getElementById('themeIcon');
    const tabsList = document.getElementById('tabsList');
    const tabCountBadge = document.getElementById('tabCountBadge');
    const presetPills = document.querySelectorAll('.preset-pill');
    const brandVersion = document.getElementById('brandVersion');
    const pageNotice = document.getElementById('pageNotice');
    const controllingBar = document.getElementById('controllingBar');
    const controllingTitle = document.getElementById('controllingTitle');
    const controllingReset = document.getElementById('controllingReset');
    const shortcutsWrap = document.getElementById('shortcutsWrap');
    const shortcutsLink = document.getElementById('shortcutsLink');

    let activeTabId = null;
    let currentTabId = null;
    let currentVolume = 100;
    let isMuted = false;
    let sendThrottleTimeout = null;

    try {
        const manifest = api.runtime.getManifest();
        if (manifest && manifest.version) brandVersion.textContent = `v${manifest.version}`;
    } catch (_) {}

    function applyTheme(theme) {
        if (theme === 'light') {
            document.body.classList.remove('dark');
            document.body.classList.add('light');
            themeIcon.src = '../icons/moon.png';
        } else {
            document.body.classList.add('dark');
            document.body.classList.remove('light');
            themeIcon.src = '../icons/sun.png';
        }
        updateMuteButtonDisplay();
        updateSliderTrack(currentVolume);
    }

    const savedTheme = localStorage.getItem('vf_theme') || 'dark';
    applyTheme(savedTheme);

    themeToggleBtn.addEventListener('click', () => {
        const isDark = document.body.classList.contains('dark');
        const nextTheme = isDark ? 'light' : 'dark';
        localStorage.setItem('vf_theme', nextTheme);
        applyTheme(nextTheme);
    });

    function formatDb(vol) {
        if (vol <= 0) return '-inf dB';
        const db = 20 * Math.log10(vol / 100.0);
        const sign = db > 0 ? '+' : '';
        return `${sign}${db.toFixed(1)} dB`;
    }

    function updateSliderTrack(vol) {
        const pct = Math.min(100, Math.max(0, (vol / 600) * 100));
        const isLight = document.body.classList.contains('light');
        const tealColor = isMuted ? '#ef4444' : (isLight ? '#0d9488' : '#32bea6');
        const emptyTrack = isLight ? '#e2e8f0' : '#2a2a32';
        volumeSlider.style.background = `linear-gradient(to right, ${tealColor} 0%, ${tealColor} ${pct}%, ${emptyTrack} ${pct}%, ${emptyTrack} 100%)`;
    }

    function updateMuteButtonDisplay() {
        const isLight = document.body.classList.contains('light');
        if (isLight) {
            muteIcon.src = isMuted ? '../icons/darkmute.png' : '../icons/darkunmute.png';
        } else {
            muteIcon.src = isMuted ? '../icons/lightmute.png' : '../icons/lightunmute.png';
        }

        muteBtn.classList.toggle('active-mute', isMuted);
    }

    function updateUI(vol, muted) {
        currentVolume = Math.round(vol);
        isMuted = !!muted;

        volumeSlider.value = currentVolume;
        volumeValue.textContent = currentVolume;
        volumeDb.textContent = formatDb(currentVolume);

        volumeValue.className = 'volume-number';
        volumeBadge.className = 'status-badge';

        if (isMuted) {
            volumeValue.classList.add('muted');
            volumeBadge.classList.add('muted');
            volumeBadge.textContent = 'muted';
        } else if (currentVolume > 100) {
            volumeValue.classList.add('boosted');
            volumeBadge.classList.add('boosted');
            volumeBadge.textContent = 'boosted';
        } else if (currentVolume === 100) {
            volumeValue.classList.add('normal');
            volumeBadge.classList.add('normal');
            volumeBadge.textContent = 'standard';
        } else {
            volumeValue.classList.add('normal');
            volumeBadge.classList.add('normal');
            volumeBadge.textContent = 'quieted';
        }

        updateMuteButtonDisplay();
        updateSliderTrack(currentVolume);

        presetPills.forEach(pill => {
            const pillVal = parseInt(pill.dataset.volume, 10);
            pill.classList.toggle('active', pillVal === currentVolume && !isMuted);
        });
    }

    function sendMessage(message) {
        try {
            return Promise.resolve(api.runtime.sendMessage(message));
        } catch (err) {
            return Promise.reject(err);
        }
    }

    function dispatchVolume(vol, muted) {
        if (sendThrottleTimeout) clearTimeout(sendThrottleTimeout);

        sendThrottleTimeout = setTimeout(() => {
            sendMessage({
                action: 'setVolume',
                tabId: currentTabId,
                volume: vol,
                muted: muted
            }).catch(() => {});
        }, 15);
    }

    volumeSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        if (isMuted) isMuted = false;
        updateUI(val, isMuted);
        dispatchVolume(val, isMuted);
    });

    presetPills.forEach(pill => {
        pill.addEventListener('click', () => {
            const val = parseInt(pill.dataset.volume, 10);
            isMuted = false;
            updateUI(val, isMuted);
            dispatchVolume(val, isMuted);
        });
    });

    muteBtn.addEventListener('click', () => {
        isMuted = !isMuted;
        updateUI(currentVolume, isMuted);
        sendMessage({
            action: 'setMute',
            tabId: currentTabId,
            muted: isMuted
        }).catch(() => {});
    });

    // content script can't run on about: pages, amo, or tabs that were already open
    async function checkPageReachable(tabId) {
        try {
            const resp = await api.tabs.sendMessage(tabId, { action: 'ping' });
            return !!(resp && resp.alive);
        } catch (_) {
            return false;
        }
    }

    function showPageNotice(message) {
        if (!message) {
            pageNotice.hidden = true;
            volumeCard.classList.remove('disabled');
            return;
        }
        pageNotice.textContent = message;
        pageNotice.hidden = false;
        volumeCard.classList.add('disabled');
    }

    function isRestrictedUrl(url) {
        if (!url) return false;
        return /^(about|moz-extension|chrome|resource|view-source|jar):/i.test(url) ||
               /^https?:\/\/(addons\.mozilla\.org|accounts\.firefox\.com)\//i.test(url);
    }

    async function selectTab(tabId, title) {
        currentTabId = tabId;

        const [state, reachable] = await Promise.all([
            sendMessage({ action: 'getVolume', tabId }).catch(() => null),
            checkPageReachable(tabId)
        ]);

        if (state && typeof state.volume === 'number') {
            updateUI(state.volume, state.muted);
        } else {
            updateUI(100, false);
        }

        if (reachable) {
            showPageNotice(null);
        } else {
            let url = '';
            try {
                const tab = await api.tabs.get(tabId);
                url = tab.url || '';
            } catch (_) {}

            if (isRestrictedUrl(url)) {
                showPageNotice('VolumeFox can\u2019t control audio on this page. Firefox blocks extensions here.');
            } else {
                showPageNotice('VolumeFox isn\u2019t connected to this page yet. Reload the tab to start controlling its volume.');
            }
        }

        if (tabId !== activeTabId && title) {
            controllingTitle.textContent = title;
            controllingBar.hidden = false;
        } else {
            controllingBar.hidden = true;
        }
    }

    controllingReset.addEventListener('click', () => {
        if (activeTabId != null) {
            selectTab(activeTabId, null);
            updateAudibleTabs();
        }
    });

    async function updateAudibleTabs() {
        let response;
        try {
            response = await sendMessage({ action: 'getAudibleTabs' });
        } catch (_) {
            return;
        }
        if (!response || !Array.isArray(response.tabs)) return;

        const tabs = response.tabs;
        tabCountBadge.textContent = tabs.length;
        tabsList.innerHTML = '';

        if (tabs.length === 0) {
            const li = document.createElement('li');
            li.className = 'empty-state';
            li.textContent = 'No tabs playing audio.';
            tabsList.appendChild(li);
            return;
        }

        tabs.forEach(tab => {
            const li = document.createElement('li');
            li.className = 'tab-item';
            if (tab.id === currentTabId) li.classList.add('current-tab');
            if (tab.audible === false) li.classList.add('silent');
            li.title = tab.id === activeTabId ? 'This tab' : 'Click to control this tab\u2019s volume';

            const leftDiv = document.createElement('div');
            leftDiv.className = 'tab-left';

            if (tab.favIconUrl && tab.favIconUrl.startsWith('http')) {
                const img = document.createElement('img');
                img.className = 'tab-icon';
                img.src = tab.favIconUrl;
                img.alt = '';
                img.onerror = () => {
                    img.style.display = 'none';
                    const dot = document.createElement('span');
                    dot.className = 'tab-fallback-dot';
                    leftDiv.insertBefore(dot, leftDiv.firstChild);
                };
                leftDiv.appendChild(img);
            } else {
                const dot = document.createElement('span');
                dot.className = 'tab-fallback-dot';
                leftDiv.appendChild(dot);
            }

            const titleSpan = document.createElement('span');
            titleSpan.className = 'tab-title-text';
            titleSpan.textContent = tab.title || 'Untitled Tab';
            leftDiv.appendChild(titleSpan);

            li.appendChild(leftDiv);

            const rightDiv = document.createElement('div');
            rightDiv.className = 'tab-right';

            const badge = document.createElement('span');
            badge.className = 'tab-vol-badge';
            if (tab.muted) {
                badge.classList.add('muted');
                badge.textContent = 'MUTED';
            } else if (tab.volume > 100) {
                badge.classList.add('boosted');
                badge.textContent = `${Math.round(tab.volume)}%`;
            } else {
                badge.textContent = `${Math.round(tab.volume || 100)}%`;
            }
            rightDiv.appendChild(badge);

            if (tab.id !== activeTabId) {
                const gotoBtn = document.createElement('button');
                gotoBtn.className = 'tab-goto';
                gotoBtn.type = 'button';
                gotoBtn.title = 'Switch to this tab';
                gotoBtn.setAttribute('aria-label', 'Switch to this tab');
                gotoBtn.textContent = '\u2197';
                gotoBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    api.tabs.update(tab.id, { active: true });
                });
                rightDiv.appendChild(gotoBtn);
            }

            li.appendChild(rightDiv);

            // switching tabs closes the popup, so just control it from here
            li.addEventListener('click', async () => {
                await selectTab(tab.id, tab.title);
                updateAudibleTabs();
            });

            tabsList.appendChild(li);
        });
    }

    if (api.commands && typeof api.commands.openShortcutSettings === 'function') {
        shortcutsWrap.hidden = false;
        shortcutsLink.addEventListener('click', (e) => {
            e.preventDefault();
            api.commands.openShortcutSettings().catch(() => {});
        });
    }

    try {
        const tabs = await api.tabs.query({ active: true, currentWindow: true });
        if (tabs.length > 0) {
            activeTabId = tabs[0].id;
            await selectTab(activeTabId, null);
        }
    } catch (err) {
        console.error('[VolumeFox Popup] Tab init failed:', err);
    }

    updateAudibleTabs();
    const pollInterval = setInterval(updateAudibleTabs, 3000);
    window.addEventListener('unload', () => clearInterval(pollInterval));
});
