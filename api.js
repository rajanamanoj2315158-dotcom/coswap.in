const API_BASE = "http://localhost:3001";

function getAuthToken() {
    return localStorage.getItem("authToken");
}

function setAuth(token, user) {
    if (token) localStorage.setItem("authToken", token);
    if (user) localStorage.setItem("loggedInUser", JSON.stringify(user));
}

function clearAuth() {
    localStorage.removeItem("authToken");
    localStorage.removeItem("loggedInUser");
}

function getCurrentUser() {
    return JSON.parse(localStorage.getItem("loggedInUser") || "null");
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

async function apiRequest(path, options = {}) {
    const headers = Object.assign(
        { "Content-Type": "application/json" },
        options.headers || {}
    );

    const token = getAuthToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers
    });

    if (res.status === 204) return null;

    const text = await res.text();
    let data;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = null;
    }

    if (!res.ok) {
        const message = (data && data.error) || text || res.statusText;
        throw new Error(message);
    }

    return data;
}
