document.addEventListener('DOMContentLoaded', function () {
    loadCookies();
    chrome.runtime.sendMessage({ action: "updateSettings" });
});

function loadCookies () {
    chrome.storage.local.get(["cached", "blocked"], function (data) {
        if (data.cached) {
            display(data.cached);
            console.log("Cookies loaded from local storage.");
        } else {
            console.log("No cached cookies found in storage, requesting retrieval from cookies.js.");
            getCookies();
        }
    });
}

chrome.runtime.sendMessage({ action: "getCookies" }, function (response) {
    if (chrome.runtime.lastError) {
        console.error("Message Error:", chrome.runtime.lastError.message);
    } else if (!response || response.error) {
        console.error("No response received or error:", response?.error);
    } else {
        console.log("Cookies received:", response.cookies);
        chrome.storage.local.set({ cached: response.cookies });
        display(response.cookies);
    }
});

function display(cookies) {
    const cookieList = document.getElementById("cookie-list");
    cookieList.innerHTML = ""; // clear

    if (cookies.length == 0) {
        document.getElementById("error-msg").innerText = "No cookies found.";
        return;
    }

    chrome.storage.local.get("blocked", function (data) {
        let blocked = data.blocked || {};
        console.log("Blocked cookies:", blocked);

        cookies.forEach(cookie => {
            let listItem = document.createElement("li");
            let isBlocked = blocked[cookie.name] === true;

            listItem.innerHTML = `
                <b>Name:</b> ${cookie.name}<br>
                <div class="cookie-info">
                    <b>Domain:</b> ${cookie.domain}<br>
                    <b>Secure:</b> ${cookie.secure ? "Yes" : "No"}<br>
                    <b>HttpOnly:</b> ${cookie.httpOnly ? "Yes" : "No"}<br>
                    <b>Session:</b> ${cookie.session ? "Yes" : "No"}<br>
                </div>
                <label class="switch">
                    <input type="checkbox" class="toggle" cookie-data="${cookie.name}" ${isBlocked ? "" : "checked"}>
                    <span class="slider"></span>
                </label>
            `;
            cookieList.appendChild(listItem);
        });

        addToggle();
    });

}

// add listeners for each cookie's toggle
function addToggle() {
    let toggles = document.querySelectorAll(".toggle");
    toggles.forEach(toggle => {
        toggle.addEventListener("change", function () {
            let cookieName = this.getAttribute("cookie-data");
            let isBlocked = !this.checked; // cookies are blocked if unselected

            chrome.storage.local.get("blocked", function (data) {
                let blocked = data.blocked || {};

                if (isBlocked) {
                    blocked[cookieName] = true;
                } else {
                    delete blocked[cookieName]; // remove from blocklist
                }

                chrome.storage.local.set({ blocked }, function () {
                    console.log(`Cookie ${cookieName} ${isBlocked ? "blocked" : "unblocked"}`);
                    chrome.runtime.sendMessage({ action: "updateSettings" });
                });
            });
        });
    });
}

// Get and display all cookies for the current active tab (only)
function getCookies() {

    // display response from cookies.js
    chrome.runtime.sendMessage({ action: "getCookies" }, function (response) {
        let errorMsg = document.getElementById("error-msg");
        errorMsg.innerHTML = ""; // clear

        if (chrome.runtime.lastError) {
            console.error("Error:", chrome.runtime.lastError.message);
        } else if (!response || response.error) {
            console.error("No response received or error:", response?.error);
            errorMsg.innerText = response?.error || "Unknown error.";
        } else  if (response.cookies) {
            chrome.storage.local.set({ cached: response.cookies });
            display(response.cookies);
            console.log("Cookies received:", response.cookies);
        } else {
            document.getElementById("error-msg").innerText = "No cookies found.";
        }

        // cookies.forEach(type => {
        //     let typeSection = document.getElementById(`${type}-list`);
        //     cookies[type].forEach(cookie => {
        //         let listItem = document.createElement("li");
        //         listItem.innerHTML = `
        //             <b>Name:</b> ${cookie.name}<br>
        //             <div class="cookie-info">
        //                 <b>Domain:</b> ${cookie.domain}<br>
        //                 <b>Secure:</b> ${cookie.secure ? "Yes" : "No"}<br>
        //                 <b>HttpOnly:</b> ${cookie.httpOnly ? "Yes" : "No"}<br>
        //                 <b>Session:</b> ${cookie.session ? "Yes" : "No"}<br>
        //             </div>
        //         `;
        //         typeSection.appendChild(listItem);
        //     });
        // });

        // ["firstParty", "thirdParty"].forEach(type => {
        //     if (!cookies[type]) cookies[type] = [];  // Initialize if missing
        //     document.getElementById(`${type}-list`).innerHTML = ""; // Clear UI section
        // });

        // ["firstParty", "thirdParty"].forEach(type => {
        //     let typeSection = document.getElementById(`${type}-list`);
        //     cookies[type].forEach(cookie => {
        //         let listItem = document.createElement("li");
        //         listItem.innerHTML = `
        //             <b>Name:</b> ${cookie.name}<br>
        //             <div class="cookie-info">
        //                 <b>Domain:</b> ${cookie.domain}<br>
        //                 <b>Secure:</b> ${cookie.secure ? "Yes" : "No"}<br>
        //                 <b>HttpOnly:</b> ${cookie.httpOnly ? "Yes" : "No"}<br>
        //                 <b>Session:</b> ${cookie.session ? "Yes" : "No"}<br>
        //             </div>
        //         `;
        //         typeSection.appendChild(listItem);
        //     });
        // });


    });
}