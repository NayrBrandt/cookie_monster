document.addEventListener('DOMContentLoaded', function () {
    let btn = document.getElementById("get-btn");
    btn.addEventListener("click", function () {
        console.log("Cookie details requested.");
        getCookies();
    });
});

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
        } else {

            console.log("Cookies received:", response.cookies);
            let cookies = response.cookies;
            const cookieList = document.getElementById("cookie-list");
            cookieList.innerHTML = ""; // clear

            // cookies.forEach(type => {
            //     if (!cookies[type]) cookies[type] = [];  // Initialize if missing
            //     document.getElementById(`${type}-list`).innerHTML = ""; // Clear UI section
            // });

            if (response.cookies.length === 0) {
                errorMsg.innerText = "No cookies found.";
            } else {
                cookies.forEach(cookie => {
                    let listItem = document.createElement("li");
                    listItem.innerHTML = `
                    <b>Name:</b> ${cookie.name}<br>
                    <div class="cookie-info">
                        <b>Domain:</b> ${cookie.domain}<br>
                        <b>Secure:</b> ${cookie.secure ? "Yes" : "No"}<br>
                        <b>HttpOnly:</b> ${cookie.httpOnly ? "Yes" : "No"}<br>
                        <b>Session:</b> ${cookie.session ? "Yes" : "No"}<br>
                    </div>
                `;
                    cookieList.appendChild(listItem);
                });
            }
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