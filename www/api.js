const DEFAULT_LOCAL_API = "http://localhost:3001";
const API_BASE_STORAGE_KEY = "coswapApiBase";
const AUTH_TOKEN_STORAGE_KEY = "authToken";
const AUTH_USER_STORAGE_KEY = "loggedInUser";
const AUTH_TOKEN_COOKIE = "coswap_auth_token";
const AUTH_USER_COOKIE = "coswap_auth_user";
const AUTH_COOKIE_DAYS = 400;

function getCookie(name) {
    const target = `${name}=`;
    const parts = document.cookie ? document.cookie.split(";") : [];

    for (const part of parts) {
        const value = part.trim();
        if (value.startsWith(target)) {
            return decodeURIComponent(value.slice(target.length));
        }
    }

    return "";
}

function setCookie(name, value, days = AUTH_COOKIE_DAYS) {
    if (!value) {
        return;
    }

    const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

function removeCookie(name) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax`;
}

function getAuthToken() {
    return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || getCookie(AUTH_TOKEN_COOKIE);
}

function setAuth(token, user) {
    if (token) {
        localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
        setCookie(AUTH_TOKEN_COOKIE, token);
    }

    if (user) {
        const serializedUser = JSON.stringify(user);
        localStorage.setItem(AUTH_USER_STORAGE_KEY, serializedUser);
        setCookie(AUTH_USER_COOKIE, serializedUser);
    }
}

function clearAuth() {
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    localStorage.removeItem(AUTH_USER_STORAGE_KEY);
    removeCookie(AUTH_TOKEN_COOKIE);
    removeCookie(AUTH_USER_COOKIE);
}

function getCurrentUser() {
    const raw = localStorage.getItem(AUTH_USER_STORAGE_KEY) || getCookie(AUTH_USER_COOKIE);

    try {
        const user = raw ? JSON.parse(raw) : null;
        if (user && !localStorage.getItem(AUTH_USER_STORAGE_KEY)) {
            localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(user));
        }
        return user;
    } catch {
        return null;
    }
}

function requireAuth(redirectTarget) {
    const token = getAuthToken();
    if (!token) {
        const fallback = `${window.location.pathname.split("/").pop() || "dashboard.html"}${window.location.search || ""}`;
        localStorage.setItem("redirectAfterLogin", redirectTarget || fallback);
        window.location.href = "login.html";
        return false;
    }
    return true;
}

function requireAdmin(redirectTarget) {
    const token = getAuthToken();
    const user = getCurrentUser();
    if (!token || !user || !user.is_admin) {
        const fallback = `${window.location.pathname.split("/").pop() || "admin-dashboard.html"}${window.location.search || ""}`;
        localStorage.setItem("redirectAfterLogin", redirectTarget || fallback);
        window.location.href = "admin-login.html";
        return false;
    }
    return true;
}

function getApiCandidates() {
    const candidates = [];
    const savedBase = localStorage.getItem(API_BASE_STORAGE_KEY);

    if (savedBase) {
        candidates.push(savedBase.replace(/\/$/, ""));
    }

    if (window.location.origin && /^https?:/i.test(window.location.origin)) {
        candidates.push(window.location.origin.replace(/\/$/, ""));
    }

    candidates.push(DEFAULT_LOCAL_API);

    return [...new Set(candidates)];
}

async function parseApiResponse(res) {
    if (res.status === 204) {
        return null;
    }

    const text = await res.text();
    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        return { error: text };
    }
}

let _activeReqs = 0;
function _toggleLoader(show) {
    if(show) _activeReqs++; else _activeReqs--;
    let loader = document.getElementById('global-api-loader');
    if(!loader) {
        loader = document.createElement('div');
        loader.id = 'global-api-loader';
        loader.innerHTML = `
            <div style="width:40px;height:40px;border:4px solid rgba(79,208,255,0.2); border-top-color:#4fd0ff; border-radius:50%; animation:apiSpin 1s linear infinite;"></div>
            <style>@keyframes apiSpin{to{transform:rotate(360deg)}}</style>
        `;
        loader.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(10,13,24,0.6);backdrop-filter:blur(3px);z-index:99999;display:none;align-items:center;justify-content:center;';
        document.body.appendChild(loader);
    }
    loader.style.display = _activeReqs > 0 ? 'flex' : 'none';
}

async function apiRequest(path, options = {}) {
    const noLoad = options.noLoad === true;
    if(!noLoad) _toggleLoader(true);
    
    const headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
    const token = getAuthToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    let lastError = null;
    try {
        for (const base of getApiCandidates()) {
            try {
                const res = await fetch(`${base}${path}`, { ...options, headers });
                const data = await parseApiResponse(res);

                if (!res.ok) {
                    const message = (data && data.error) || res.statusText || "Request failed.";
                    throw new Error(message);
                }

                localStorage.setItem(API_BASE_STORAGE_KEY, base);
                if(!noLoad) _toggleLoader(false);
                return data;
            } catch (error) {
                lastError = error;
                if (!(error instanceof TypeError || /failed to fetch/i.test(String(error)))) {
                    throw error; // Not network related, throw normally
                }
            }
        }
        throw new Error("Unable to connect to service. Operating in offline/cached mode.");
    } catch(e) {
        if(!noLoad) _toggleLoader(false);
        if(window.showToast) window.showToast(e.message, 3000);
        throw e;
    }
}
