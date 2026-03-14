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
    // Premium UI Particles Init
    (function initMist() {
      const container = document.querySelector(".mist-container");
      if (!container) return;

      const count = window.innerWidth < 768 ? 8 : 22;
      for (let i = 0; i < count; i++) {
        const droplet = document.createElement("div");
        droplet.className = "mist-droplet";

        const size = Math.random() * 16 + 4; // 4px - 20px
        const left = Math.random() * 100;
        const delay = Math.random() * 15;
        const duration = Math.random() * 12 + 8; // 8s - 20s
        const opacity = Math.random() * 0.15 + 0.1; // 0.1 - 0.25
        const sway = (Math.random() - 0.5) * 120;

        droplet.style.width = `${size}px`;
        droplet.style.height = `${size}px`;
        droplet.style.left = `${left}%`;
        droplet.style.animationDelay = `${delay}s`;
        droplet.style.setProperty("--duration", `${duration}s`);
        droplet.style.setProperty("--max-opacity", opacity);
        droplet.style.setProperty("--sway", `${sway}px`);

        container.appendChild(droplet);
      }
    })();

    // Page Arrival Motion
    document.body.classList.add("fade-in");

    // Global Mobile Overlay
    let overlay = document.querySelector('.sidebar-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        document.body.appendChild(overlay);
    }

    const menuBtn = document.getElementById('menuToggle');
    const sidebar = document.getElementById('sidebar');

    if (menuBtn && sidebar) {
        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            sidebar.classList.toggle('active');
            overlay.classList.toggle('open');
        });

        overlay.addEventListener('click', () => {
            sidebar.classList.remove('active');
            overlay.classList.remove('open');
        });
    }
  });
})();
