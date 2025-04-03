document.addEventListener('DOMContentLoaded', () => {
    loadCookies();
    // clearAllRules();
});

let currentDomain = null;

function loadCookies() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        // const url = new URL(tabs[0].url);
        currentDomain = new URL(tabs[0].url).hostname.replace(/^www\./, '').toLowerCase();
        console.log("Current domain:", currentDomain);

        // retrieve cookies from local storage or from cookies.js if not yet cached
        chrome.storage.local.get("cookies", function (data) {
            const domainData = data.cookies?.[currentDomain] || {};
            if (domainData.cached?.length > 0) {
                display(domainData.cached, domainData.blocked);
                console.log("Cookies loaded from cache for", currentDomain);
            } else {
                chrome.runtime.sendMessage({ action: "getCookies" }, (response) => {
                    if (response?.cookies) {
                        console.log("Caching fresh cookies:", response.cookies);
                        
                        // Always cache fresh cookies
                        domainData.cached = response.cookies;
                        data.cookies[currentDomain] = domainData;
                        chrome.storage.local.set({ cookies: data.cookies });

                        display(response.cookies, response.blocked);
                        console.log("Cookies retrieved and displayed for", currentDomain);
                    }
                });
            }
        });
    });
}

chrome.runtime.onMessage.addListener(async function (request) {
    if (request.action === "getCookies") {
        console.log("Cookies received:", request.cookies);
        let { cookies } = await chrome.storage.local.get("cookies");
        let domainData = cookies[currentDomain] || { cached: [], blocked: {} };

        // Update storage with latest cookie state
        domainData.cached = request.cookies;
        domainData.blocked = request.blocked;
        cookies[currentDomain] = domainData;

        await chrome.storage.local.set({ cookies });

        display(domainData.cached, domainData.blocked);
    }
});

// async function clearAllRules() {
//     let existingRules = await chrome.declarativeNetRequest.getDynamicRules();
//     let removeIds = existingRules.map(rule => rule.id);

//     if (removeIds.length > 0) {
//         console.log(`Clearing ${removeIds.length} leftover rules.`);
//         await chrome.declarativeNetRequest.updateDynamicRules({
//             removeRuleIds: removeIds,
//             addRules: []
//         });
//     } else {
//         console.log("No leftover rules found.");
//     }
// }

chrome.cookies.onChanged.addListener(function (changeInfo) {
    const cookie = changeInfo.cookie;
    const domain = extractDomain(cookie.domain); // Adjust to extract the domain appropriately

    chrome.storage.local.get("cookies", function (data) {
        const stored = data.cookies || {};
        const domainData = stored[domain] || { blocked: {}, cached: [] };

        // If the cookie is being removed, remove it from the cached and blocked lists
        if (changeInfo.removed) {
            // Remove from cached cookies if it's not blocked
            console.log(`Cookie removed: ${cookie.name}`);
            
            // REMOVE ONLY from blocked (keep in cached)
            if (domainData.blocked[cookie.name]) {
                delete domainData.blocked[cookie.name];
            }
        } else {
            console.log(`Cookie added/updated: ${cookie.name}`);

            // Ensure cookie is in cached
            let existingCookie = domainData.cached.find(c => c.name === cookie.name);
            if (existingCookie) {
                existingCookie.value = cookie.value; // Update value
            } else {
                domainData.cached.push(cookie); // Add new cookie
            }
        }

        // Update storage with the modified domain data
        stored[domain] = domainData;

        chrome.storage.local.set({ cookies: stored }, function () {
            console.log(`Cookies updated for ${domain}:`, domainData);

            // If necessary, trigger updateBlockRules or other actions
            chrome.runtime.sendMessage({ action: "updateBlockRules" });
        });
    });
});

// Helper function to extract the domain from the cookie
function extractDomain(domain) {
    return domain.startsWith('.') ? domain.slice(1) : domain;
}


function display(cookies, blocked = {}) {
    let cookieList = document.getElementById("cookie-list");
    cookieList.innerHTML = ""; // clear

    if (!cookies?.length) {
        document.getElementById("error-msg").innerText = "No cookies found.";
        return;
    }

    cookies.forEach(cookie => {
        const isBlocked = blocked[cookie.name];
        const listItem = document.createElement("li");

        listItem.innerHTML = `
            <b>Name:</b> ${cookie.name}<br>
            <b>Domain:</b> ${cookie.domain}<br>
            <b>HttpOnly:</b> ${cookie.httpOnly ? "Yes" : "No"}<br>
            <label class="switch">
                <input type="checkbox" class="toggle" cookie-name="${cookie.name}" ${isBlocked ? "" : "checked"}>
                <span class="slider"></span>
            </label>
        `;
        cookieList.appendChild(listItem);
    });

    document.querySelectorAll(".toggle").forEach(toggle => {
        toggle.addEventListener("change", addToggle);
    });

}

function getUrl(cookie) { // format urls
    let domain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
    let security = cookie.secure ? 'https' : 'http';
    return `${security}://${domain}${cookie.path}`;
}

// handle cookie toggle on/off logic
async function addToggle(e) {
    const cookieName = e.target.getAttribute("cookie-name");

    console.log(`${cookieName} toggled.`);
    const isBlocked = !e.target.checked;


    let { cookies } = await chrome.storage.local.get("cookies");
    let domainData = cookies[currentDomain] || { cached: [], blocked: {} };

    const cookie = domainData.cached.find(c => c.name === cookieName);
    if (!cookie) {
        console.warn(`Cookie ${cookieName} not found in cache, fetching again.`);

        // Fetch latest cookies and update cache
        await new Promise(resolve => {
            chrome.runtime.sendMessage({ action: "getCookies" }, (response) => {
                if (response?.cookies) {
                    domainData.cached = response.cookies;
                    cookie = domainData.cached.find(c => c.name === cookieName);
                }
                resolve();
            });
        });

        if (!cookie) {
            console.error(`Still couldn't find cookie ${cookieName}.`);
            return;
        }
    }
    // block logic
    console.log(`Formatted URL for ${cookie.name}:`, getUrl(cookie));
    try {
        if (isBlocked) {
            domainData.blocked[cookieName] = true;
            console.log(`${cookieName} added to block list.`)
            // console.log(`URL: ${getUrl(cookie)}`);
            // console.log(`HttpOnly: ${cookie.httpOnly}`);
            // console.log(`Secure: ${cookie.secure}`);
            // console.log(`SameSite: ${cookie.sameSite}`);
            await chrome.cookies.remove({
                url: getUrl(cookie),
                name: cookieName,
                storeId: cookie.storeId
            });
            console.log(`${cookieName} successfully blocked.`);
        } else {
            delete domainData.blocked[cookieName];
            console.log(`${cookieName} removed from block list.`);
            const found = await chrome.cookies.getAll({ url: getUrl(cookie) })
                .then(cookies => cookies.find(c => c.name === cookieName));
            // const found = domainData.cached.find(c => c.name === cookieName);
            if (found) {
                console.log(`Unblocked ${cookieName} already exists in site cookies, will not be restored.`);
            } else {
                console.log(`Restoring unblocked cookie ${cookieName} from cache.`);
                await chrome.cookies.set({
                    url: getUrl(cookie),
                    name: cookie.name,
                    value: cookie.value,
                    domain: cookie.domain,
                    path: cookie.path,
                    secure: cookie.secure,
                    httpOnly: cookie.httpOnly,
                    storeId: cookie.storeId,
                    expirationDate: cookie.expirationDate || Math.floor(Date.now() / 1000) + 2592000 // 30 days
                });
                console.log(`${cookieName} successfully unblocked.`);
            }
            // }
        }
    } catch {
        console.error("Error updating cookie:", error);
    }

    const wasBlocked = domainData.blocked[cookieName];
    if (isBlocked !== wasBlocked) {
        domainData.blocked[cookieName] = isBlocked ? true : undefined;
        await chrome.storage.local.set({ cookies });
        await chrome.runtime.sendMessage({ action: "updateBlockRules" });
    }
    

    // Refresh display
    display(domainData.cached, domainData.blocked);
}