document.addEventListener('DOMContentLoaded', () => {
    openTab('Preview');

    const tabButtons = document.querySelectorAll('.tablinks');

    tabButtons.forEach(button => {
        button.addEventListener('click', function () {
            const tabName = button.textContent.trim();
            console.log(`Tab clicked: ${tabName}`); 

            openTab(tabName);

            if (tabName === 'Cookies') {
                loadCookies();
            }
        });
    });
});

function openTab(tabName) {
    const tabContents = document.querySelectorAll('.tabcontent');
    tabContents.forEach(content => content.classList.remove('active'));
  
    const tabButtons = document.querySelectorAll('.tablinks');
    tabButtons.forEach(button => button.classList.remove('active'));

    document.getElementById(tabName).classList.add('active');

    const activeButton = Array.from(tabButtons).find(button => button.textContent.trim() === tabName);
    if (activeButton) {
        activeButton.classList.add('active');
    }
}


function loadCookies() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        currentDomain = new URL(tabs[0].url).hostname.replace(/^www\./, '').toLowerCase();

        // retrieve cookies from local storage or from cookies.js if not yet cached
        chrome.storage.local.get("cookies", function (data) {
            let domainData = data.cookies?.[currentDomain] || {};
            if (domainData?.cached && domainData.cached.length > 0) {
                display(domainData.cached, domainData.blocked);
                console.log("Cookies loaded from cache for", currentDomain);
            } else {
                chrome.runtime.sendMessage({ action: "getCookies" }, (response) => {
                    if (response?.cookies) {
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
        display(domainData.cached, domainData.blocked);
    }
});

async function clearAllRules() {
    let existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    let removeIds = existingRules.map(rule => rule.id);

    if (removeIds.length > 0) {
        console.log(`Clearing ${removeIds.length} leftover rules.`);
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: removeIds,
            addRules: []
        });
    } else {
        console.log("No leftover rules found.");
    }
}


async function display(cookies, blocked = {}) {
    let cookieList = document.getElementById("cookie-list");
    cookieList.innerHTML = "";

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
                <input type="checkbox" class="toggle" cookie-name="${cookie.name}" id="${cookie.name}-toggle" ${isBlocked ? "" : "checked"}>
                <span class="slider"></span>
            </label>
        `;
        cookieList.appendChild(listItem);
    });

    document.querySelectorAll(".toggle").forEach(toggle => {
        toggle.addEventListener("change", addToggle);
    });

}


// handle cookie toggle on/off logic
async function addToggle(e) {
    const cookieName = e.target.getAttribute("cookie-name");
    console.log(`${cookieName} toggled.`);
    const isBlocked = !e.target.checked; // not checked = blocked

    let { cookies } = await chrome.storage.local.get("cookies");

    if (!cookies[currentDomain].blocked) cookies[currentDomain].blocked = {};

    // Only update storage if there's an actual change
    const wasBlocked = !!cookies[currentDomain].blocked[cookieName];
    if (isBlocked) {
        if (!wasBlocked) {
            cookies[currentDomain].blocked[cookieName] = true;
            await chrome.storage.local.set({ cookies });
            await chrome.runtime.sendMessage({ action: "updateBlockRules" });
            // console.log("updateBlockRules called by function addToggle.");
        }
    } else {
        if (wasBlocked) {
            delete cookies[currentDomain].blocked[cookieName];
            await chrome.storage.local.set({ cookies });
            await chrome.runtime.sendMessage({ action: "updateBlockRules" });
            // console.log("updateBlockRules called by function addToggle.");
        }
    }
    // console.log("Toggle change detected, proceeding with block/unblock logic and rule updates.")
    console.log("Loading cookies at end of addToggle function.")
    loadCookies();
}


const siteRemoveToggle = document.getElementById('site_remove');
siteRemoveToggle.addEventListener('change', function() {
    if (this.checked && this.id === 'site_remove') {
        removeSiteCookies();
    }
  });

function removeSiteCookies() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        currentDomain = new URL(tabs[0].url).hostname.replace(/^www\./, '').toLowerCase();
    });

    chrome.storage.local.get("cookies", function (data) {
        let domainData = data.cookies?.[currentDomain] || {};
        if (domainData?.cached && domainData.cached.length > 0) {
            domainData.cached.forEach(cookie => {
                const cookieUrl = (cookie.secure ? "https://" : "http://") + cookie.domain + cookie.path;
                chrome.cookies.remove({ url: cookieUrl, name: cookie.name }, function(details) {
                    if (details){
                        console.log(`Deleted cookie: ${cookie.name} from ${cookieUrl}`);
                    } else {
                        console.error(`Failed to delete cookie: ${cookie.name} from ${cookieUrl}`);
                    }
                })
        });
        } else {
            console.log("No cookies found for ", currentDomain);
        }
    });

    // Doesn't work properly.
    siteRemoveToggle.classList.add('flashing');
    setTimeout(() => {
        siteRemoveToggle.checked = false;
    }, 1000);
    
}
