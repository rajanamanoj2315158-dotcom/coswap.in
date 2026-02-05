(function () {
  function ensureToast() {
    let el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      document.body.appendChild(el);
    }
    return el;
  }

  window.showToast = function showToast(message, durationMs = 2200) {
    const el = ensureToast();
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), durationMs);
  };

  const nativeAlert = window.alert;
  window.alert = function (message) {
    try {
      window.showToast(String(message || "Done"));
    } catch (err) {
      nativeAlert(message);
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    // no theme toggle; keep page-specific backgrounds
  });
})();
