document.addEventListener('DOMContentLoaded', function() {
    const volumeSlider = document.getElementById('volumeSlider');
    const toggleThemeBtn = document.getElementById('toggleTheme');
    const tabsList = document.getElementById('tabsList');

    // Restore theme from localStorage if set
    if (localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark');
    }

    // Volume slider: Slider value 100 corresponds to gain 1.0.
    volumeSlider.addEventListener('input', (e) => {
        const volume = e.target.value;
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
                    li.textContent = tab.title;
                    tabsList.appendChild(li);
                });
            }
        });
    }

    // Update audible tabs on load and every 5 seconds.
    updateAudibleTabs();
    setInterval(updateAudibleTabs, 5000);
});
