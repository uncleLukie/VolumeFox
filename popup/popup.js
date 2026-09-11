/**
 * VolumeFox - Popup Controller
 * Handles slider adjustments, presets, mute toggle, and audible tabs list.
 */
document.addEventListener('DOMContentLoaded', async function() {
    'use strict';

    const api = typeof browser !== 'undefined' ? browser : chrome;

    // Elements
    const volumeSlider = document.getElementById('volumeSlider');
    const volumeValue = document.getElementById('volumeValue');
    const volumeDb = document.getElementById('volumeDb');
    const volumeBadge = document.getElementById('volumeBadge');
    const muteBtn = document.getElementById('muteBtn');
    const muteIcon = document.getElementById('muteIcon');
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    const themeIcon = document.getElementById('themeIcon');
    const tabsList = document.getElementById('tabsList');
    const tabCountBadge = document.getElementById('tabCountBadge');
    const presetPills = document.querySelectorAll('.preset-pill');

    // Local State
    let currentTabId = null;
    let currentVolume = 100;
    let isMuted = false;
    let sendThrottleTimeout = null;

    // 1. Theme Management
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

    // 2. Format dB
    function formatDb(vol) {
        if (vol <= 0) return '-inf dB';
        const db = 20 * Math.log10(vol / 100.0);
        const sign = db > 0 ? '+' : '';
        return `${sign}${db.toFixed(1)} dB`;
    }

    // 3. Update Slider Track Fill (Teal)
    function updateSliderTrack(vol) {
        const pct = Math.min(100, Math.max(0, (vol / 600) * 100));
        const isLight = document.body.classList.contains('light');
        const tealColor = isMuted ? '#ef4444' : (isLight ? '#0d9488' : '#32bea6');
        const emptyTrack = isLight ? '#e2e8f0' : '#2a2a32';
        volumeSlider.style.background = `linear-gradient(to right, ${tealColor} 0%, ${tealColor} ${pct}%, ${emptyTrack} ${pct}%, ${emptyTrack} 100%)`;
    }

    // 4. Update Mute Icon
    function updateMuteButtonDisplay() {
        const isLight = document.body.classList.contains('light');
        if (isLight) {
            muteIcon.src = isMuted ? '../icons/darkmute.png' : '../icons/darkunmute.png';
        } else {
            muteIcon.src = isMuted ? '../icons/lightmute.png' : '../icons/lightunmute.png';
        }

        if (isMuted) {
            muteBtn.classList.add('active-mute');
        } else {
            muteBtn.classList.remove('active-mute');
        }
    }

    // 5. Update UI Components
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

        // Highlight active preset pill
        presetPills.forEach(pill => {
            const pillVal = parseInt(pill.dataset.volume, 10);
            if (pillVal === currentVolume && !isMuted) {
                pill.classList.add('active');
            } else {
                pill.classList.remove('active');
            }
        });
    }

    // 6. Send volume to background/content script
    function dispatchVolume(vol, muted) {
        if (sendThrottleTimeout) clearTimeout(sendThrottleTimeout);

        sendThrottleTimeout = setTimeout(() => {
            api.runtime.sendMessage({
                action: 'setVolume',
                tabId: currentTabId,
                volume: vol,
                muted: muted
            }).catch(() => {});
        }, 15);
    }

    // Slider input event
    volumeSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        if (isMuted) isMuted = false;
        updateUI(val, isMuted);
        dispatchVolume(val, isMuted);
    });

    // Preset pills click event
    presetPills.forEach(pill => {
        pill.addEventListener('click', () => {
            const val = parseInt(pill.dataset.volume, 10);
            isMuted = false;
            updateUI(val, isMuted);
            dispatchVolume(val, isMuted);
        });
    });

    // Mute toggle button
    muteBtn.addEventListener('click', () => {
        isMuted = !isMuted;
        updateUI(currentVolume, isMuted);
        api.runtime.sendMessage({
            action: 'setMute',
            tabId: currentTabId,
            muted: isMuted
        }).catch(() => {});
    });

    // 7. Audible Tabs List
    function updateAudibleTabs() {
        api.runtime.sendMessage({ action: 'getAudibleTabs' }, response => {
            if (api.runtime.lastError || !response || !Array.isArray(response.tabs)) return;

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
                if (tab.id === currentTabId) {
                    li.classList.add('current-tab');
                }

                const leftDiv = document.createElement('div');
                leftDiv.className = 'tab-left';

                if (tab.favIconUrl && tab.favIconUrl.startsWith('http')) {
                    const img = document.createElement('img');
                    img.className = 'tab-icon';
                    img.src = tab.favIconUrl;
                    img.onerror = () => {
                        img.style.display = 'none';
                        const dot = document.createElement('span');
                        dot.className = 'tab-fallback-dot';
                        leftDiv.appendChild(dot);
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

                const badge = document.createElement('span');
                badge.className = 'tab-vol-badge';
                if (tab.muted) {
                    badge.classList.add('muted');
                    badge.textContent = 'MUTED';
                } else if (tab.volume > 100) {
                    badge.classList.add('boosted');
                    badge.textContent = `${tab.volume}%`;
                } else {
                    badge.textContent = `${tab.volume || 100}%`;
                }
                li.appendChild(badge);

                li.addEventListener('click', () => {
                    api.tabs.update(tab.id, { active: true });
                    currentTabId = tab.id;
                    updateUI(tab.volume || 100, !!tab.muted);
                    updateAudibleTabs();
                });

                tabsList.appendChild(li);
            });
        });
    }

    // 8. Initialize active tab
    try {
        const tabs = await api.tabs.query({ active: true, currentWindow: true });
        if (tabs.length > 0) {
            currentTabId = tabs[0].id;
            api.runtime.sendMessage({ action: 'getVolume', tabId: currentTabId }, state => {
                if (state && typeof state.volume === 'number') {
                    updateUI(state.volume, state.muted);
                } else {
                    updateUI(100, false);
                }
            });
        }
    } catch (err) {
        console.error('[VolumeFox Popup] Tab init failed:', err);
    }

    updateAudibleTabs();
    const pollInterval = setInterval(updateAudibleTabs, 3000);
    window.addEventListener('unload', () => clearInterval(pollInterval));
});
