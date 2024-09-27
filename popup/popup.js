// popup/popup.js
document.addEventListener('DOMContentLoaded', function() {
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
            tabSlider.min = 1;
            tabSlider.max = 800;
            tabSlider.value = 100;
            tabSlider.className = 'tabSlider';
            tabItem.appendChild(tabSlider);

            const tabVolumeLabel = document.createElement('span');
            tabVolumeLabel.textContent = '100%';
            tabVolumeLabel.className = 'tabVolumeLabel';
            tabItem.appendChild(tabVolumeLabel);

            // Send message to content script to get current volume
            chrome.tabs.sendMessage(tab.id, { type: 'getVolume' }, function(response) {
                if (chrome.runtime.lastError) {
                    console.error(chrome.runtime.lastError.message);
                    // Optionally, display an error message in the UI
                } else if (response && response.volume != null) {
                    tabSlider.value = response.volume;
                    tabVolumeLabel.textContent = response.volume + '%';
                }
            });

            // Add event listener for slider change
            tabSlider.addEventListener('input', function() {
                const volume = tabSlider.value;
                tabVolumeLabel.textContent = volume + '%';
                chrome.tabs.sendMessage(tab.id, { type: 'setVolume', volume: parseInt(volume) });
            });

            // Prevent focus on tab when interacting with slider
            tabSlider.addEventListener('click', function(event) {
                event.stopPropagation();
            });

            // Optional: Focus on tab when clicked
            tabItem.addEventListener('click', function(event) {
                if (event.target !== tabSlider) {
                    chrome.tabs.update(tab.id, { active: true });
                }
            });

            tabsList.appendChild(tabItem);
        }
    });
});
