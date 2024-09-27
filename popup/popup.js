// popup/popup.js
document.addEventListener('DOMContentLoaded', function() {
    const themeToggle = document.getElementById('themeToggle');
    let currentTheme = 'dark'; // Default to dark theme
    const muteButtons = []; // Store references to mute buttons

    // Load and apply the saved theme, then create the tabs list
    chrome.storage.local.get('theme', function(data) {
        currentTheme = data.theme || 'dark';
        applyTheme(currentTheme);

        // Now create the tabs list
        createTabsList();
    });

    // Theme Toggle Event Listener
    themeToggle.addEventListener('click', function() {
        currentTheme = currentTheme === 'light' ? 'dark' : 'light';
        chrome.storage.local.set({ 'theme': currentTheme }, function() {
            applyTheme(currentTheme);
            updateAllMuteButtons();
        });
    });

    function applyTheme(theme) {
        document.body.classList.remove('dark-theme', 'light-theme');
        document.body.classList.add(theme + '-theme');
        if (theme === 'dark') {
            themeToggle.src = '../icons/sun.png';
        } else {
            themeToggle.src = '../icons/moon.png';
        }
    }

    function createTabsList() {
        // Query for tabs with audio playing and list them in the popup
        chrome.tabs.query({ audible: true }, function(tabs) {
            const tabsList = document.getElementById('tabsList');
            for (let tab of tabs) {
                const tabItem = document.createElement('div');
                tabItem.className = 'tabItem';

                const tabIcon = document.createElement('img');
                tabIcon.src = tab.favIconUrl || '../icons/volume16.png';
                tabIcon.className = 'tabIcon';
                tabItem.appendChild(tabIcon);

                const tabTitle = document.createElement('span');
                tabTitle.textContent = tab.title;
                tabTitle.className = 'tabTitle';
                tabItem.appendChild(tabTitle);

                // Create volume slider
                const tabSlider = document.createElement('input');
                tabSlider.type = 'range';
                tabSlider.min = 0;
                tabSlider.max = 800;
                tabSlider.value = 100;
                tabSlider.className = 'tabSlider';
                tabItem.appendChild(tabSlider);

                const tabVolumeLabel = document.createElement('span');
                tabVolumeLabel.textContent = '100%';
                tabVolumeLabel.className = 'tabVolumeLabel';
                tabItem.appendChild(tabVolumeLabel);

                // Create mute button
                const muteButton = document.createElement('img');
                muteButton.className = 'muteButton';
                tabItem.appendChild(muteButton);

                // Store mute button for theme updates
                muteButtons.push({ muteButton: muteButton, tabId: tab.id });

                // Send message to content script to get current volume and mute state
                chrome.tabs.sendMessage(tab.id, { type: 'getVolume' }, function(response) {
                    if (chrome.runtime.lastError) {
                        console.error(chrome.runtime.lastError.message);
                    } else if (response && response.volume != null) {
                        const volume = Math.round(response.volume);
                        tabSlider.value = volume;
                        tabVolumeLabel.textContent = volume + '%';
                    }
                });

                chrome.tabs.sendMessage(tab.id, { type: 'getMute' }, function(response) {
                    if (response && response.muted != null) {
                        updateMuteButtonIcon(muteButton, response.muted);
                    }
                });

                // Add event listener for slider change
                tabSlider.addEventListener('input', function() {
                    const volume = parseInt(tabSlider.value);
                    tabVolumeLabel.textContent = volume + '%';
                    chrome.tabs.sendMessage(tab.id, { type: 'setVolume', volume: volume }, function() {
                        const isMuted = (volume === 0);
                        updateMuteButtonIcon(muteButton, isMuted);
                    });
                });

                // Mute Button Event Listener
                muteButton.addEventListener('click', function(event) {
                    event.stopPropagation();
                    chrome.tabs.sendMessage(tab.id, { type: 'getMute' }, function(response) {
                        if (response && response.muted != null) {
                            const newMuteState = !response.muted;
                            chrome.tabs.sendMessage(tab.id, { type: 'setMute', mute: newMuteState }, function() {
                                updateMuteButtonIcon(muteButton, newMuteState);
                                if (newMuteState) {
                                    tabSlider.value = 0;
                                    tabVolumeLabel.textContent = '0%';
                                } else {
                                    // Restore volume to last known level
                                    chrome.tabs.sendMessage(tab.id, { type: 'getVolume' }, function(response) {
                                        if (response && response.volume != null) {
                                            const volume = Math.round(response.volume);
                                            tabSlider.value = volume;
                                            tabVolumeLabel.textContent = volume + '%';
                                        }
                                    });
                                }
                            });
                        }
                    });
                });

                function updateMuteButtonIcon(muteButton, isMuted) {
                    let iconPrefix = '';
                    if (currentTheme === 'dark') {
                        iconPrefix = 'light'; // Use light icons in dark theme
                    } else {
                        iconPrefix = 'dark'; // Use dark icons in light theme
                    }
                    if (isMuted) {
                        muteButton.src = `../icons/${iconPrefix}mute.png`;
                    } else {
                        muteButton.src = `../icons/${iconPrefix}unmute.png`;
                    }
                }

                // Prevent focus on tab when interacting with controls
                tabSlider.addEventListener('click', function(event) {
                    event.stopPropagation();
                });
                muteButton.addEventListener('click', function(event) {
                    event.stopPropagation();
                });

                // Focus on tab when clicking elsewhere on the tab item
                tabItem.addEventListener('click', function(event) {
                    if (event.target !== tabSlider && event.target !== muteButton) {
                        chrome.tabs.update(tab.id, { active: true });
                    }
                });

                tabsList.appendChild(tabItem);
            }
        });
    }

    // Function to update all mute button icons when the theme changes
    function updateAllMuteButtons() {
        muteButtons.forEach(function(item) {
            chrome.tabs.sendMessage(item.tabId, { type: 'getMute' }, function(response) {
                if (response && response.muted != null) {
                    updateMuteButtonIcon(item.muteButton, response.muted);
                }
            });
        });
    }
});
