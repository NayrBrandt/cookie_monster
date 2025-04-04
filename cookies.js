// cookies.js: process cookies in the background, separate from popup script
// Listen for getCookies() function call in popup.js

if (!chrome.runtime.onMessage.hasListener(cookieCall)) {
    chrome.runtime.onMessage.addListener(cookieCall);
}

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({ cookies: {} });
});

async function updateBlockRules() {
    let { cookies } = await chrome.storage.local.get("cookies"); // TODO: handle a toggled cookie that hasn't yet been stored in storage
    if (!cookies) return;
    console.log("Blocklist modified, updating rules.")


    // Remove cookies that have been unblocked from net request block list
    // Replace rules with updated block list
    let old = await chrome.declarativeNetRequest.getDynamicRules();
    let removeIds = old.map(rule => rule.id);

    let blocked = new Map();
    for (const domain in cookies) {
        for (const cookieName in cookies[domain].blocked || {}) {
            if (!blocked.has(domain)) {
                blocked.set(domain, new Set());
            }
            blocked.get(domain).add(cookieName);
        }
    }

    // console.log(`Removing ${removeIds.length} rules.`)

    let newRules = [];
    let increment = removeIds.length > 0 ? removeIds.length + 1 : 1;

    blocked.forEach((cookieNames, domain) => {

        let url = domain.startsWith("www.")
            ? `*://${domain}/*`
            : domain.startsWith(".")
                ? `*://${domain}/*`
                : `*://.${domain}/*`;

        cookieNames.forEach(cookieName => {
            // domainFormats.forEach(url => {
            console.log(`Creating rules for ${cookieName} on ${domain}`); // TODO: does this block requests from third parties? is the current domain being returned always first-party?

            let count1 = increment++;
            let count2 = increment++;

            // 2 rules for each cookie:
            // 1. Block Set-Cookie header to block requests to replace blocked cookie
            newRules.push({
                id: count1,
                priority: 1,
                action: {
                    type: "modifyHeaders",
                    responseHeaders: [{
                        header: "Set-Cookie",
                        operation: "remove"
                    }]
                },
                condition: {
                    urlFilter: url,
                    resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest", "script", "other"]
                }
            });
            // 2. Block Cookie header to block requests that send blocked cookie to site
            newRules.push({
                id: count2,
                priority: 1,
                action: {
                    type: "modifyHeaders",
                    requestHeaders: [{
                        header: "Cookie",
                        operation: "remove"
                    }]
                },
                condition: {
                    urlFilter: url,
                    resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest", "script", "other"]
                }
            });
        });
    });

    try {
        console.log(`Removing ${removeIds.length} old rules and adding ${newRules.length} new ones...`);
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: removeIds,
            addRules: newRules
        });
        console.log(`Updated cookie request blocking rules. ${newRules.length} rules added.`);
    } catch (error) {
        console.error("Failed to update rules:", error);
    }
}


function cookieCall(request, sender, sendResponse) {
    if (request.action === "getCookies") {
        console.log("Received getCookies request.")
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {

            if (!tabs[0].url?.startsWith('http')) {
                sendResponse({ error: "Cannot get cookies for this page." });
                return;
            }
            const domain = new URL(tabs[0].url).hostname.replace(/^www\./, '').toLowerCase();
            getAllCookies(domain, sendResponse);
        });

        return true; // async
    }
    else if (request.action === "updateBlockRules") {
        updateBlockRules();
    }

}

async function getAllCookies(domain, sendResponse) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });


        // Get all resource URLs being called by host (first-party) webpage
        const resourceUrls = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                // Get all external domains contacted by the page
                const domains = new Set();
                // Check scripts
                document.querySelectorAll('script[src]').forEach(s => {
                    try { domains.add(new URL(s.src).hostname); } catch { }
                });
                // Check images
                document.querySelectorAll('img[src]').forEach(s => {
                    try { domains.add(new URL(s.src).hostname); } catch { }
                });
                // Check iframes
                document.querySelectorAll('iframe[src]').forEach(s => {
                    try { domains.add(new URL(s.src).hostname); } catch { }
                });
                return Array.from(domains);
            }
        });

        // frame urls: external websites embedded in the host page (ads, videos, etc.)
        // combine current tab url, frame urls, and resource urls to retrieve all cookies
        const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
        const allUrls = [...new Set([tab.url, ...frames.map(f => f.url), ...(resourceUrls[0]?.result || [])].filter(Boolean))];

        console.log(`All URLs called by host domain ${domain}:`, allUrls);

        // call cookies.getAll() for each url
        // will contain duplicates: some cookies are called from multiple domains/subdomains
        const allCookies = (await Promise.all(allUrls.map(url =>
            chrome.cookies.getAll({}).catch(() => [])
        ))).flat();
        // make map to clear duplicates
        const cookies = Array.from(new Map(allCookies.map(c => [c.name, c])).values());

        console.log(`${cookies.length} cookies found for ${domain}.`);

        chrome.storage.local.get("cookies", function (data) {
            const stored = data.cookies || {};
            stored[domain] = { cached: cookies, blocked: stored[domain]?.blocked || {} };

            chrome.storage.local.set({ cookies: stored }, () => {
                sendResponse({
                    cookies: cookies.filter(c => !stored[domain].blocked?.[c.name]),
                    blocked: stored[domain].blocked,
                    domain: domain
                });
            });
            console.log(`Cache created for ${domain}:`, stored[domain]);
        });
    } catch (error) {
        console.error("Error in getAllCookies method:", error);
        sendResponse({ error: error.message });
    }
}

