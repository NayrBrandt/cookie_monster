// cookies.js: process cookies in the background, separate from popup script
// Listen for getCookies() function call in popup.js

if (!chrome.runtime.onMessage.hasListener(cookieCall)) {
    chrome.runtime.onMessage.addListener(cookieCall);
}

function cookieCall(request, sender, sendResponse) {
    if (request.action === "getCookies") {
        console.log("Getting cookies...");
        getAllCookies(sendResponse);
        return true; // always return true for async responses (async = this is a background process separate from popup.js)
    }
}

async function getAllCookies(sendResponse) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab?.url?.startsWith('http')) {
            sendResponse({ error: "Cannot get cookies for this page." });
            return;
        }

        const url = new URL(tab.url);
        const domain = url.hostname.replace(/^www\./, '').toLowerCase();
        console.log("Current domain:", domain);

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
        const frameUrls = [...new Set(frames
            .map(frame => frame.url)
            .filter(url => url && url.startsWith('http')))];
        
        const allUrls = [...new Set([
            tab.url,
            ...frameUrls,
            ...(resourceUrls[0]?.result || [])
        ].filter(Boolean))];

        console.log(`All URLs called by host domain ${domain}:`, allUrls);

        // call cookies.getAll() for each url
        // will contain duplicates: some cookies are called from multiple domains/subdomains
        // array of arrays: each array contains cookies for a specific url
        const arrays = await Promise.all(
            allUrls.map(url => 
                chrome.cookies.getAll({ url })
                    .catch(err => {
                        console.warn(`Failed to get cookies for ${url}:`, err);
                        return [];
                    })
            )
        );
        const all = arrays.flat();

        // filter out duplicate cookies
        const cMap = new Map();
        all.forEach(c => {
            // console.log(`Cookie: ${c.name}, Domain: ${c.domain}, Path: ${c.path}, Host-Only: ${c.hostOnly}, Secure: ${c.secure}, HttpOnly: ${c.httpOnly}`);
            const key = `${c.name}:${c.domain}:${c.path}`;
            if (!cMap.has(key)) {
                cMap.set(key, c);
            }
        });

        const cookies = Array.from(cMap.values());

        sendResponse({cookies});
        console.log(cookies.length, "cookies found.");

    } catch (error) {
        console.error("Error in getAllCookies method:", error);
        sendResponse({ error: error.message });
    }
}


// async function cookieSort(cookies, domain, frameUrls) {
//     const result = { firstParty: [], thirdParty: [] };
//     const baseDomain = domain.replace(/^(www\.|\.)/, '').toLowerCase();
//     const seen = new Set();

//     // Extract cookies frame base domains
//     const frameDomains = new Set(frameUrls.map(url => {
//         try {
//             return new URL(url).hostname.replace(/^(www\.|\.)/, '').toLowerCase();
//         } catch {
//             return null;
//         }
//     }).filter(Boolean));

//     for (const cookie of cookies) {
//         const key = `${cookie.name}:${cookie.domain}:${cookie.path}`;
//         if (seen.has(key)) continue;
//         seen.add(key);

//         const cookieDomain = cookie.domain.replace(/^(www\.|\.)/, '').toLowerCase();

//         // Identify third-party: If the cookie domain is not part of the current tab or its frames
//         const isFirstParty = cookieDomain === baseDomain || cookieDomain.endsWith(`.${baseDomain}`);

//         if (isFirstParty) {
//             result.firstParty.push(cookie);
//         } else {
//             result.thirdParty.push(cookie);
//         }
//     }

//     result.firstParty.sort((a, b) => a.name.localeCompare(b.name));
//     result.thirdParty.sort((a, b) => a.name.localeCompare(b.name));

//     console.log("Sorting results:", {
//         firstPartyCount: result.firstParty.length,
//         thirdPartyCount: result.thirdParty.length
//     });

//     return result;
// }
