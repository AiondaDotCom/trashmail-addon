var login_details = browser.storage.sync.get(["username", "password"]).then(function (storage) {
    var data = {
        "cmd": "login",
        "fe-login-user": storage["username"],
        "fe-login-pass": storage["password"]
    };

    return callAPI(data);
});

async function addressManager() {
    try {
        const baseUrl = await getApiBaseUrl();
        const url = baseUrl + "/?cmd=manager";
        const details = await login_details;

        let params = new URLSearchParams({
            "lang": browser.i18n.getUILanguage().substr(0, 2),
            "session_id": details["session_id"]
        });
        await browser.tabs.create({"url": url.concat("&", params.toString())});
        window.close();
    } catch (error) {
        let error_msg = document.getElementById("error_msg");
        error_msg.textContent = error;
        error_msg.style.display = "block";
    }
}

document.getElementById("btn-address-manager").addEventListener("click", addressManager);

document.getElementById("btn-options").addEventListener("click", function () {
    browser.runtime.openOptionsPage().then(function () {
        window.close();
    });
});
