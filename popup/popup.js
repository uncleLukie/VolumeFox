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
