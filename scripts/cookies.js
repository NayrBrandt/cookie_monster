// cookies.js: process cookies in the background, separate from popup script
// Listen for getCookies() function call in popup.js

if (!chrome.runtime.onMessage.hasListener(cookieCall)) {
    chrome.runtime.onMessage.addListener(cookieCall);
}

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({ cookies: {} });
});

let intercepted = new Map();

chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
        if (!details.responseHeaders) return;
        console.log("Header received:", details);

        let headers = details.responseHeaders.filter(h => h.name.toLowerCase() === 'set-cookie');

        if (headers.length > 0) {
            const domain = new URL(details.url).hostname;

            let cookies = headers.map(h => parseHeaders(h.value));

            if (!intercepted.has(domain)) {
                intercepted.set(domain, []);
            }
            intercepted.get(domain).push(...cookies);

            console.log(`Intercepted Set-Cookie: ${cookie.name}=${cookie.value} from ${details.url}`);
            chrome.storage.local.get("cookies", (data) => {
                let stored = data.cookies || {};
                let url = new URL(details.url).hostname;
                if (!stored[url]) {
                    stored[url] = { cached: [], blocked: {}};
                }
                stored[url].cached.push(...cookies);

                // Save updated cookies
                console.log(`${stored[url].cached.length} cookies stored for ${url}.`);
                chrome.storage.local.set({ cookies: stored });
            });
        }
    },
    { urls: ["<all_urls>"] },
    ["responseHeaders"]
);

// Add this to your background script
chrome.cookies.onChanged.addListener((changeInfo) => {
    if (changeInfo.removed) return;
    let cookie = changeInfo.cookie;
    
    let domain = cookie.domain.startsWith('.') 
        ? cookie.domain.substring(1) 
        : cookie.domain;
        
    if (!intercepted.has(domain)) {
        intercepted.set(domain, []);
    }
    
    intercepted.get(domain).push(cookie);
    
    chrome.storage.local.get("cookies", (data) => {
        let stored = data.cookies || {};
        if (!stored[domain]) {
            stored[domain] = { cached: [], blocked: {} };
        }
        stored[domain].cached.push(cookie);
        chrome.storage.local.set({ cookies: stored });
    });
});

function parseHeaders(header) {
    if (!header) return null;

    const [info, ...attributes] = header.split(';').map(p => p.trim());
    const [name, value] = info.includes('=')
        ? info.split('=')
        : [info, ''];

    if (!name) return null;
    
    const cookie = { name, value };
    attributes.forEach(attr => {
        const [key, val] = attr.includes('=')
            ? attr.split('=')
            : [attr, true];
        if (key) cookie[key.toLowerCase()] = val;
    });
    
    return cookie;
}

async function updateBlockRules() {
    let { cookies = {} } = await chrome.storage.local.get("cookies"); // TODO: handle a toggled cookie that hasn't yet been stored in storage
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
    let increment = removeIds.length > 0 ? Math.max(...removeIds) + 1 : 1;

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

        let firstCookies = await chrome.cookies.getAll({ url: tab.url });

        // Get all resource URLs being called by host (first-party) webpage
        const resourceUrls = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                const domains = new Set();
                document.querySelectorAll('[src], [href]').forEach(el => {
                    try {
                        const url = new URL(el.src || el.href, location.href);
                        domains.add(url.hostname);
                    } catch {}
                });

                if (window.performance) {
                    performance.getEntriesByType("resource").forEach(resource => {
                        try {
                            const url = new URL(resource.name);
                            domains.add(url.hostname);
                        } catch { }
                    });
                }

                return Array.from(domains);
            }
        });
        console.log("Resource urls:", resourceUrls)
        let resourceCookies = await Promise.all(
            (resourceUrls[0]?.result || []).map(domain =>
                chrome.cookies.getAll({ domain })
            )
        );
        console.log("Resource cookies:", resourceCookies);
        // frame urls: external websites embedded in the host page (ads, videos, etc.)
        // combine current tab url, frame urls, and resource urls to retrieve all cookies

        // 2. Get all frames
        const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
        const frameCookies = await Promise.all(
            frames.map(frame =>
                frame.url.startsWith('http')
                    ? chrome.cookies.getAll({ url: frame.url })
                    : Promise.resolve([])
            )
        );
        console.log("Frames:", frames);
        console.log("Frame cookies:", frameCookies);

        let all = [
            ...firstCookies,
            ...frameCookies.flat(),
            ...resourceCookies.flat()
        ];

        if (intercepted.has(domain)) {
            all.push(...intercepted.get(domain));
        }

        let unique = Array.from(
            new Map(all.map(c => [`${c.name}|${c.domain}|${c.path}`, c])).values()
        );

        const { cookies: stored = {} } = await chrome.storage.local.get("cookies");
        const currData = stored[domain] || { cached: [], blocked: {} };
        
        let update = {
            ...stored,
            [domain]: {
                cached: unique,
                blocked: currData.blocked
            }
        };
        await chrome.storage.local.set({ cookies: update });

        // let filtered = unique.filter(
        //     c => !currData.blocked?.[c.name]
        // );
        console.log(`${unique.length} cookies found for ${domain}.`);
        sendResponse({
            cookies: unique,
            blocked: currData.blocked,
            domain: domain
        });

    } catch (error) {
        console.error("Error in getAllCookies method:", error);
        sendResponse({ error: error.message });
    }
}
