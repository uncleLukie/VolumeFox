document.addEventListener('DOMContentLoaded', function() {
    const volumeSlider = document.getElementById('volumeSlider');
    const volumeLabel = document.getElementById('volumeLabel');

    // Load the current volume boost level from storage and set the slider value
    chrome.storage.sync.get('boostLevel', function(data) {
        const boostLevel = data.boostLevel || 100;
        volumeSlider.value = boostLevel;
        volumeLabel.textContent = boostLevel + '%';
    });

    // Listen for changes on the slider
    volumeSlider.addEventListener('input', function() {
        const boostLevel = volumeSlider.value;
        volumeLabel.textContent = boostLevel + '%';

        // Save the boost level to storage
        chrome.storage.sync.set({ boostLevel: boostLevel });

        // Inject the content script to adjust the volume on the current page
        chrome.tabs.executeScript({
            code: `(${changeSoundVolume.toString()})(${boostLevel});`
        });
    });

    // Query for tabs with audio playing and list them in the popup
    chrome.tabs.query({audible: true}, function(tabs) {
        const tabsList = document.getElementById('tabsList');
        for (let tab of tabs) {
            const tabItem = document.createElement('div');
            const tabIcon = document.createElement('img');
            tabIcon.src = tab.favIconUrl;
            tabIcon.className = 'tabIcon';
            tabItem.appendChild(tabIcon);

            const tabTitle = document.createElement('span');
            tabTitle.textContent = tab.title;
            tabItem.appendChild(tabTitle);

            tabItem.className = 'tabItem';

            // Add a click listener to focus on the clicked tab
            tabItem.addEventListener('click', function() {
                chrome.tabs.update(tab.id, { active: true });
            });

            tabsList.appendChild(tabItem);
        }
    });
});

function changeSoundVolume(boostLevel) {
    const media = [...document.querySelectorAll('video, audio')];
    for (const target of media) {
        if (!target.audiocontext) {
            target.audiocontext = new AudioContext();
            target.creategain = target.audiocontext.createGain();
            target.source = target.audiocontext.createMediaElementSource(target);
            target.source.connect(target.creategain);
            target.creategain.connect(target.audiocontext.destination);
        }
        const newVolume = boostLevel / 100;
        if (newVolume !== target.creategain.gain.value) {
            target.creategain.gain.value = newVolume;
        }
    }
}
