document.addEventListener('DOMContentLoaded', function () {
    let btn = document.getElementById("get-btn");
    btn.addEventListener("click", function() {
        console.log("Cookie details requested.");
        getCookies();
    });
});

// Get and display all cookies for the current active tab (only)
function getCookies() {

    // display response from cookies.js
    chrome.runtime.sendMessage({ action: "getCookies" }, function (response) {
        if (!response) {
            console.error("No response received");
            return;
        }
        console.log("Response received.", response);

        let cookieList = document.getElementById("cookie-list");
        cookieList.innerHTML = ""; // (re)initialize list

        let errorMsg = document.getElementById("error-msg");
        errorMsg.innerHTML = ""; // clear

        if (response.error) {
            errorMsg.innerHTML = `${response.error}`;
        }
        else {
            let cookies = response.cookies;
            cookies.forEach(cookie => {
                let listItem = document.createElement("li");
                // Possibly useful info:
                //      cookie.session (short vs long-term storage): if true, the cookie is deleted when the browser is closed
                //      cookie.secure: if true, the cookie is limited to secure channels only (aka HTTPS)
                listItem.innerHTML = `
                                    <b>Name:</b> ${cookie.name}<br>
                                    <div class="cookie-info">
                                        Domain: ${cookie.domain}<br>
                                        Session-Only: ${cookie.session ? "Yes" : "No"}<br>
                                        Secure: ${cookie.secure ? "Yes" : "No"} <br>
                                        Path: ${cookie.path}<br>
                                    </div>`;
                cookieList.appendChild(listItem);
            })
        }

    });
}