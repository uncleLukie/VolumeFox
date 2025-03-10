document.addEventListener('DOMContentLoaded', function() {
    const volumeSlider = document.getElementById('volumeSlider');
    const volumeDisplay = document.getElementById('volumeDisplay');
    const toggleThemeBtn = document.getElementById('toggleTheme');
    const tabsList = document.getElementById('tabsList');

    // Restore theme from localStorage if set
    if (localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark');
    }

    // Restore volume level from localStorage or default to 100
    const savedVolume = localStorage.getItem('volumeLevel') || '100';
    volumeSlider.value = savedVolume;
    volumeDisplay.textContent = savedVolume + '%';

    // Volume slider: Slider value 100 corresponds to gain 1.0.
    volumeSlider.addEventListener('input', (e) => {
        const volume = e.target.value;
        volumeDisplay.textContent = volume + '%';
        localStorage.setItem('volumeLevel', volume);
        chrome.runtime.sendMessage({ action: 'setVolume', volume: volume }, function(response) {
            if (response && response.success) {
                console.log('Volume adjusted to: ', volume);
            }
        });
    });

    // Theme toggle button functionality
    toggleThemeBtn.addEventListener('click', () => {
        document.body.classList.toggle('dark');
        const newTheme = document.body.classList.contains('dark') ? 'dark' : 'light';
        localStorage.setItem('theme', newTheme);
    });

    // Query tabs playing audio and update the list
    function updateAudibleTabs() {
        chrome.tabs.query({ audible: true }, function(tabs) {
            tabsList.innerHTML = '';
            if (tabs.length === 0) {
                const li = document.createElement('li');
                li.textContent = 'No tabs playing audio.';
                tabsList.appendChild(li);
            } else {
                tabs.forEach((tab) => {
                    const li = document.createElement('li');

                    // If available, create an image for the tab's favicon.
                    if (tab.favIconUrl) {
                        const img = document.createElement('img');
                        img.src = tab.favIconUrl;
                        li.appendChild(img);
                    }

                    // Create a span for the tab title and truncate if needed.
                    const span = document.createElement('span');
                    span.classList.add('tab-title');
                    span.textContent = tab.title || 'Untitled';
                    li.appendChild(span);

                    tabsList.appendChild(li);
                });
            }
        });
    }

    // Update audible tabs on load and every 5 seconds.
    updateAudibleTabs();
    setInterval(updateAudibleTabs, 5000);
});
