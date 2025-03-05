// cookies.js: process cookies in the background, separate from popup script
// Listen for getCookies() function call in popup.js

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.action === "getCookies") {
        console.log("Getting cookies...")
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (tabs.length === 0) {
                sendResponse({ error: "No active tabs found." });
                return true;
            }
            let tab = tabs[0];
            let url = tab.url;
            console.log("Name of active tab:", tab.title);
            console.log("Tab URL:", url);

            chrome.cookies.getAll({ url: url }, function (cookies) {
                if (chrome.runtime.lastError) {
                    sendResponse({ error: "Error retrieving cookies." });
                } else if (cookies.length === 0) {
                    sendResponse({ error: "No cookies were found on this page." });
                } else {
                    sendResponse({ cookies: cookies });
                }
            });
        });

        // return true for asynchronous responses (background processes)
        return true;
    }
});