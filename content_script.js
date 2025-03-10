(function() {
    // Map to hold media elements and their associated AudioContext and GainNode.
    const mediaContexts = new Map();

    function attachAudioBooster(mediaElement) {
        if (mediaContexts.has(mediaElement)) return; // Avoid re‑attaching.
        try {
            const audioContext = new AudioContext();
            const source = audioContext.createMediaElementSource(mediaElement);
            const gainNode = audioContext.createGain();
            // Default gain: 1.0 (100% volume)
            gainNode.gain.value = 1.0;
            source.connect(gainNode);
            gainNode.connect(audioContext.destination);
            mediaContexts.set(mediaElement, { audioContext, source, gainNode });

            // Ensure the AudioContext resumes if it starts suspended (common in browsers).
            if (audioContext.state === 'suspended') {
                const resumeAudio = () => {
                    audioContext.resume();
                    mediaElement.removeEventListener('play', resumeAudio);
                };
                mediaElement.addEventListener('play', resumeAudio);
            }
        } catch (err) {
            console.error('Error attaching audio booster:', err);
        }
    }

    // Attach the booster to any existing media elements.
    const mediaElements = document.querySelectorAll('video, audio');
    mediaElements.forEach(attachAudioBooster);

    // Use a MutationObserver to detect new media elements added to the page.
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.matches && node.matches('video, audio')) {
                        attachAudioBooster(node);
                    }
                    // Also search within the node for media elements.
                    const childMedia = node.querySelectorAll && node.querySelectorAll('video, audio');
                    if (childMedia && childMedia.length) {
                        childMedia.forEach(attachAudioBooster);
                    }
                }
            });
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Listen for messages from the popup or background to set volume.
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'setVolume') {
            const sliderValue = parseFloat(message.volume);
            // Convert slider value to gain: 100 -> 1.0, 300 -> 3.0, etc.
            const gainValue = sliderValue / 100;
            mediaContexts.forEach(({ gainNode }) => {
                gainNode.gain.value = gainValue;
            });
            sendResponse({ success: true });
        }
    });
})();
