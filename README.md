# VolumeFox
 VolumeFox is a browser extension designed to give users precise control over the volume of media content in their browser. It allows users to boost or reduce the audio levels easily and provides a view of active tabs playing audio.

 ![z7M4lawAfx](https://github.com/uncleLukie/VolumeFox/assets/22523084/f49492eb-a17c-4f26-8496-7a909fc72f9c)

## Technical Overview

### Architecture

VolumeFox primarily consists of the following components:

1. **Popup UI**: Provides the user interface to control volume and view tabs playing audio.
2. **Background Script**: Maintains the state of the extension and handles tab interactions.
3. **Content Script**: Injected into web pages to control the volume of media elements.

### How It Works

1. **Volume Control**:
    - The volume is controlled using the Web Audio API. When the user adjusts the volume using the slider, the content script adjusts the gain value of media elements (`<audio>` and `<video>`) in the current web page.
    - An `AudioContext` is created for each media element, and the volume level is modified through a `GainNode`.
    - The extension stores the current volume level in `chrome.storage.local` to persist the user's volume preference across sessions.

2. **Listing Tabs with Audio**:
    - The extension queries all tabs with the `audible` property set to `true` to determine which tabs are currently playing audio.
    - The popup displays a list of these tabs, allowing users to easily navigate to them.

3. **Storage**:
    - The extension uses `chrome.storage.local` to store the user's volume preference. This allows for fast retrieval of the volume level when the popup is reopened, ensuring a consistent user experience.

## Installation


To install VolumeFox, you can [download it from the Firefox Add-ons store](https://addons.mozilla.org/en-US/firefox/addon/volumefox/) or package the extension files and load it manually into Firefox.
