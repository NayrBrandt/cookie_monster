// cookies.js: process cookies in the background, separate from popup script
// Listen for getCookies() function call in popup.js

if (!chrome.runtime.onMessage.hasListener(cookieCall)) {
    chrome.runtime.onMessage.addListener(cookieCall);
}

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({ cookies: {} });
});

// set network blocking rules when extension is launched
chrome.runtime.onStartup.addListener(async () => {
    console.log("Extension launched, applying network blocking rules...");
    await updateBlockRules();
});





// update network blocking rules when a cookie is added or removed from list
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.cookies) {
        console.log("Detected cookie storage change, updating rules...");
        updateBlockRules();
    }
});

async function updateBlockRules() {
    let { cookies } = await chrome.storage.local.get("cookies");
    if (!cookies) return;
    console.log("Blocklist modified, updating rules.")


    // Remove cookies that have been unblocked from net request block list
    // Replace rules with updated block list
    let old = await chrome.declarativeNetRequest.getDynamicRules();
    let removeIds = old.map(rule => rule.id);
    let usedIds = new Set(old.map(rule => rule.id));


    // let idCount = usedIds.size > 0 ? Math.max(...usedIds) + 1 : 1;

    let blocked = new Map();
    for (const domain in cookies) {
        for (const cookieName in cookies[domain].blocked || {}) {
            if (!blocked.has(domain)) {+
                blocked.set(domain, new Set());
            }
            blocked.get(domain).add(cookieName);
        }
    }

    console.log(`Removing ${removeIds.length} rules.`)

    let newRules = [];
    // let idCount = 1;

    blocked.forEach((cookieNames, domain) => {

        const domainFormats = [
            `*://*.${domain}/*`,
            `*://${domain}/*`,
            `*://*.www.${domain}/*`
        ];

        cookieNames.forEach(cookieName => {
            domainFormats.forEach(url => {
                console.log(`Creating rules for ${cookieName} on ${domain}`);

                let idCount = Date.now();
                while (usedIds.has(idCount)) idCount++;
                // 2 rules for each cookie:
                // 1. Block Set-Cookie header to block requests to replace blocked cookie
                newRules.push({
                    id: idCount,
                    priority: 1,
                    action: {
                        type: "modifyHeaders",
                        responseHeaders: [{
                            header: "Set-Cookie",
                            operation: "remove"
                            // value: `(?i)(^|;\\s*)${cookieName}=[^;]*`,
                            // regex: true
                        }]
                    },
                    condition: {
                        urlFilter: url,
                        resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest", "script", "other"]
                    }
                });

                usedIds.add(idCount);
                idCount = Date.now();

                while (usedIds.has(idCount)) idCount++;

                // 2. Block Cookie header to block requests that send blocked cookie to site
                newRules.push({
                    id: idCount,
                    priority: 1,
                    action: {
                        type: "modifyHeaders",
                        requestHeaders: [{
                            header: "Cookie",
                            operation: "remove"
                            // value: `(^|;\\s*)${cookieName}=[^;]*`,
                            // regex: true
                        }]
                    },
                    condition: {
                        urlFilter: url,
                        resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest", "script", "other"]
                    }
                });
                usedIds.add(idCount);
                idCount++;
            });
        });
    });

    try {
        // remove all existing rules
        if (removeIds.length > 0) {
            console.log(`Removing ${removeIds.length} old rules...`);
            await chrome.declarativeNetRequest.updateDynamicRules({
                removeRuleIds: removeIds,
                addRules: []
            });
        }

        // replace with updated rules
        if (newRules.length > 0) {
            await chrome.declarativeNetRequest.updateDynamicRules({
                removeRuleIds: [],
                addRules: newRules
            });
        }
        console.log(`Updated cookie request blocking rules. ${newRules.length} rules added.`);
    } catch (error) {
        console.error("Failed to update rules:", error);
    }
}


function cookieCall(request, sender, sendResponse) {
    if (request.action === "getCookies") {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {

            if (!tabs[0].url?.startsWith('http')) {
                sendResponse({ error: "Cannot get cookies for this page." });
                return;
            }
            const domain = new URL(tabs[0].url).hostname.replace(/^www\./, '').toLowerCase();


            chrome.storage.local.get("cookies", function (data) {
                const domainData = data.cookies?.[domain] || {};
                if (domainData.cached) {
                    console.log("Cached cookies found for", domain);
                    sendResponse({
                        cookies: domainData.cached.filter(c => !domainData.blocked?.[c.name]),
                        blocked: domainData.blocked || {},
                        domain: domain
                    });
                } else {
                    console.log("Fetching cookies for", domain);
                    getAllCookies(domain, sendResponse);
                }
            });
        });

        return true; // async
    }
    else if (request.action === "updateBlockRules") {
        console.log("Received request to update network blocking rules.");
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
                return performance.getEntriesByType("resource").map(e => e.name);
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
            chrome.cookies.getAll({ url }).catch(() => [])
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

function getUrl(cookie) {
    let domain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
    let security = cookie.secure ? 'https' : 'http';
    return `${security}://${domain}${cookie.path}`;
}
