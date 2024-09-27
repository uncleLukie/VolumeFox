// content_script.js
(function() {
    let audioContext;
    let gainNode;
    let sourceNodes = new Map();
    let isMuted = false;
    let lastVolume = 100;

    function init() {
        if (!audioContext) {
            try {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                gainNode = audioContext.createGain();
                gainNode.connect(audioContext.destination);
            } catch (e) {
                console.error('AudioContext error:', e);
            }
        }
    }

    function connectMediaElements() {
        const mediaElements = document.querySelectorAll('video, audio');
        mediaElements.forEach(mediaElement => {
            if (!sourceNodes.has(mediaElement)) {
                try {
                    const source = audioContext.createMediaElementSource(mediaElement);
                    source.connect(gainNode);
                    sourceNodes.set(mediaElement, source);

                    // Remove from map when media element ends
                    mediaElement.addEventListener('ended', () => {
                        sourceNodes.delete(mediaElement);
                    });
                } catch (e) {
                    console.error('Error connecting media element:', e);
                }
            }
        });
    }

    function setVolume(volume) {
        init();
        if (gainNode) {
            gainNode.gain.value = volume / 100;
            lastVolume = volume;
            isMuted = (volume === 0);
            connectMediaElements();
        }
    }

    function getVolume() {
        if (gainNode) {
            return Math.round(gainNode.gain.value * 100);
        } else {
            return 100;
        }
    }

    function setMute(mute) {
        init();
        if (gainNode) {
            isMuted = mute;
            if (isMuted) {
                gainNode.gain.value = 0;
            } else {
                gainNode.gain.value = lastVolume / 100;
            }
        }
    }

    function getMute() {
        return isMuted;
    }

    // Listen for messages from the popup script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'setVolume') {
            setVolume(message.volume);
        } else if (message.type === 'getVolume') {
            init();
            connectMediaElements();
            sendResponse({ volume: getVolume() });
        } else if (message.type === 'setMute') {
            setMute(message.mute);
        } else if (message.type === 'getMute') {
            sendResponse({ muted: getMute() });
        }
    });
})();
