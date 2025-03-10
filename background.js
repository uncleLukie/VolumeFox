chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'setVolume') {
        // Relay the setVolume message to the active tab's content script.
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (tabs.length > 0) {
                chrome.tabs.sendMessage(tabs[0].id, message, function(response) {
                    sendResponse(response);
                });
            }
        });
        return true; // Keep the message channel open for asynchronous response.
    }
});
