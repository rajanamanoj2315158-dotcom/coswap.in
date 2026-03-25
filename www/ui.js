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

  // Global XSS Sanitization
  window.escapeHtml = function(unsafe) {
    if (!unsafe) return "";
    return String(unsafe)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

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

    // ─── Top-Tier Startup UI Motion Engine ───
    
    // 1. Liquid Cursor Glow Tracker
    const cursor = document.createElement('div');
    cursor.className = 'cursor-glow';
    document.body.appendChild(cursor);

    let cursorActive = false;
    let cursorTimeout;

    document.addEventListener('mousemove', (e) => {
      if (window.innerWidth < 768) return;
      
      cursorActive = true;
      cursor.style.opacity = '1';
      cursor.style.transform = `translate3d(${e.clientX - 75}px, ${e.clientY - 75}px, 0)`;
      
      clearTimeout(cursorTimeout);
      cursorTimeout = setTimeout(() => {
        cursor.style.opacity = '0';
      }, 1500);
    });

    // 2. Parallax Scroll Engine (Performance Optimized)
    let lastScrollY = window.scrollY;
    let ticking = false;

    function updateParallax() {
      if (window.innerWidth < 768) return;
      document.documentElement.style.setProperty('--scroll-y', `${window.scrollY}`);
      ticking = false;
    }

    window.addEventListener('scroll', () => {
      if (!ticking) {
        window.requestAnimationFrame(updateParallax);
        ticking = true;
      }
    });

    // 3. Smooth Page Flow Transitions
    document.body.classList.add('page-ready');
    const mainWrapper = document.querySelector('main') || document.body;
    mainWrapper.classList.add('page-transition-wrapper');

    document.addEventListener('click', (e) => {
      const link = e.target.closest('a');
      if (link && link.href && link.target !== '_blank' && 
          link.href.includes(window.location.hostname) && 
          !link.href.includes('#') && !e.metaKey && !e.ctrlKey) {
        
        e.preventDefault();
        const destination = link.href;
        
        mainWrapper.classList.add('page-exit');
        setTimeout(() => {
          window.location.href = destination;
        }, 300);
      }
    });

    // Page Arrival Motion (Existing)
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
