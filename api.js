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

async function apiRequest(path, options = {}) {
    const headers = Object.assign(
        { "Content-Type": "application/json" },
        options.headers || {}
    );

    const token = getAuthToken();
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    const candidates = getApiCandidates();
    let lastError = null;

    for (const base of candidates) {
        try {
            const res = await fetch(`${base}${path}`, {
                ...options,
                headers
            });

            const data = await parseApiResponse(res);

            if (!res.ok) {
                const message = (data && data.error) || res.statusText || "Request failed.";
                throw new Error(message);
            }

            localStorage.setItem(API_BASE_STORAGE_KEY, base);
            return data;
        } catch (error) {
            lastError = error;

            const isNetworkFailure =
                error instanceof TypeError ||
                /failed to fetch/i.test(String(error && error.message));

            if (!isNetworkFailure) {
                throw error;
            }
        }
    }

    throw new Error(
        "Unable to connect to the COSWAP service. Start the backend or update the deployed API URL."
    );
}
