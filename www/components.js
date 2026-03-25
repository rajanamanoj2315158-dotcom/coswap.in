(function() {
    function injectNavbar() {
        const navbar = document.querySelector('.navbar');
        if (!navbar) return;

        const currentPath = window.location.pathname.split('/').pop() || 'index.html';
        const links = [
            { name: 'Browse', href: 'browse.html' },
            { name: 'Sell', href: 'sell.html' },
            { name: 'My Listings', href: 'dashboard.html' },
            { name: 'Messages', href: 'chatlist.html' },
            { name: 'Profile', href: 'profile.html' }
        ];

        const navLinksHtml = links.map(link => `
            <a href="${link.href}" class="nav-link ${currentPath === link.href ? 'active' : ''}">${link.name}</a>
        `).join('');

        navbar.innerHTML = `
            <a href="index.html" class="logo">
                <img src="logo.png" alt="CoSwap" loading="lazy">
                <span>CoSwap</span>
            </a>
            
            <div class="nav-menu" id="navMenu">
                ${navLinksHtml}
            </div>

            <div class="nav-right">
                <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=coswap" alt="Avatar" class="user-avatar" onclick="window.location.href='profile.html'" loading="lazy">
                <button class="hamburger-btn" id="menuToggle">
                    <i data-lucide="menu"></i>
                </button>
                <i data-lucide="log-out" class="logout-icon" onclick="handleLogout()" style="width: 20px; cursor: pointer;"></i>
            </div>
        `;

        if (window.lucide) window.lucide.createIcons();

        const toggle = document.getElementById('menuToggle');
        const menu = document.getElementById('navMenu');
        if (toggle && menu) {
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                menu.classList.toggle('active');
            });
            document.addEventListener('click', () => {
                menu.classList.remove('active');
            });
        }
    }

    function injectFooter() {
        if (document.querySelector('.footer')) return;
        
        const footer = document.createElement('footer');
        footer.className = 'footer';
        footer.innerHTML = `
            <div class="container">
                <div class="footer-grid">
                    <div>
                        <a href="index.html" class="logo" style="margin-bottom: 24px; display: flex; align-items: center; gap: 12px; text-decoration: none; color: white;">
                            <img src="logo.png" alt="CoSwap" style="width: 32px;">
                            <span style="font-weight: 800; font-size: 20px;">CoSwap</span>
                        </a>
                        <p style="color: rgba(255,255,255,0.5); font-size: 14px; line-height: 1.6;">The most secure and efficient marketplace for coupon exchange. Built for the modern web.</p>
                    </div>
                    <div>
                        <h4 style="margin-bottom: 24px; font-size: 16px; color: white;">Platform</h4>
                        <ul style="list-style: none; padding: 0; display: grid; gap: 12px;">
                            <li><a href="browse.html" style="color: rgba(255,255,255,0.5); text-decoration: none; font-size: 14px;">Browse Coupons</a></li>
                            <li><a href="sell.html" style="color: rgba(255,255,255,0.5); text-decoration: none; font-size: 14px;">Sell Your Coupon</a></li>
                            <li><a href="dashboard.html" style="color: rgba(255,255,255,0.5); text-decoration: none; font-size: 14px;">Marketplace Activity</a></li>
                        </ul>
                    </div>
                    <div>
                        <h4 style="margin-bottom: 24px; font-size: 16px; color: white;">Company</h4>
                        <ul style="list-style: none; padding: 0; display: grid; gap: 12px;">
                            <li><a href="terms.html" style="color: rgba(255,255,255,0.5); text-decoration: none; font-size: 14px;">Terms of Service</a></li>
                            <li><a href="#" style="color: rgba(255,255,255,0.5); text-decoration: none; font-size: 14px;">Privacy Policy</a></li>
                            <li><a href="report.html" style="color: rgba(255,255,255,0.5); text-decoration: none; font-size: 14px;">Help & Support</a></li>
                        </ul>
                    </div>
                    <div>
                        <h4 style="margin-bottom: 24px; font-size: 16px; color: white;">Social</h4>
                        <div style="display: flex; gap: 16px;">
                            <a href="#" style="color: rgba(255,255,255,0.5);"><i data-lucide="twitter"></i></a>
                            <a href="#" style="color: rgba(255,255,255,0.5);"><i data-lucide="github"></i></a>
                            <a href="#" style="color: rgba(255,255,255,0.5);"><i data-lucide="instagram"></i></a>
                        </div>
                    </div>
                </div>
                <div class="footer-bottom">
                    <span>&copy; 2026 CoSwap Technologies Inc. All rights reserved.</span>
                    <div style="display: flex; gap: 24px;">
                        <a href="#" style="color: inherit; text-decoration: none;">Security</a>
                        <a href="#" style="color: inherit; text-decoration: none;">Status</a>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(footer);
        if (window.lucide) window.lucide.createIcons();
    }

    function injectCookieConsent() {
        if (localStorage.getItem('cookieConsent')) return;
        
        const banner = document.createElement('div');
        banner.className = 'cookie-banner';
        banner.style.cssText = `
            position: fixed; bottom: 24px; left: 24px; right: 24px; max-width: 400px;
            background: rgba(15, 23, 42, 0.95); backdrop-filter: blur(20px);
            border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; padding: 24px;
            z-index: 10001; box-shadow: 0 20px 50px rgba(0,0,0,0.5);
            animation: slideUp 0.5s cubic-bezier(0.2, 0.8, 0.2, 1); transition: all 0.3s ease;
        `;
        
        banner.innerHTML = `
            <h3 style="margin-bottom: 12px; font-size: 18px; color: white;">Cookie Privacy</h3>
            <p style="color: rgba(255,255,255,0.6); font-size: 14px; line-height: 1.5; margin-bottom: 24px;">We use cookies to enhance your experience and analyze our traffic. By clicking "Accept All", you consent to our use of cookies.</p>
            <div style="display: flex; gap: 12px;">
                <button id="acceptCookies" class="button-primary" style="flex: 1; height: 44px; font-size: 14px; cursor: pointer;">Accept All</button>
                <button id="declineCookies" class="button-secondary" style="flex: 1; height: 44px; font-size: 14px; cursor: pointer;">Essential Only</button>
            </div>
        `;
        
        document.body.appendChild(banner);
        document.getElementById('acceptCookies').onclick = () => {
            localStorage.setItem('cookieConsent', 'all');
            banner.style.opacity = '0';
            banner.style.transform = 'translateY(20px)';
            setTimeout(() => banner.remove(), 300);
        };
        document.getElementById('declineCookies').onclick = () => {
            localStorage.setItem('cookieConsent', 'essential');
            banner.style.opacity = '0';
            banner.style.transform = 'translateY(20px)';
            setTimeout(() => banner.remove(), 300);
        };
    }

    function injectSplashScreen() {
        if (document.getElementById('app-splash')) return;
        const splash = document.createElement('div');
        splash.id = 'app-splash';
        splash.style.cssText = `
            position:fixed; top:0; left:0; width:100%; height:100%;
            background:#0a0d18; display:flex; flex-direction:column;
            align-items:center; justify-content:center; z-index:100000;
            transition: opacity 0.5s ease;
        `;
        splash.innerHTML = `
            <img src="logo.png" style="width:80px; height:80px; margin-bottom:20px; animation: pulse 2s infinite;">
            <div style="color:white; font-weight:800; font-size:24px; letter-spacing:-1px;">CoSwap</div>
            <style>
                @keyframes pulse { 0% { opacity:0.5; transform:scale(0.95); } 50% { opacity:1; transform:scale(1); } 100% { opacity:0.5; transform:scale(0.95); } }
            </style>
        `;
        document.body.appendChild(splash);
        window.addEventListener('load', () => {
            setTimeout(() => {
                splash.style.opacity = '0';
                setTimeout(() => splash.remove(), 500);
            }, 800);
        });
    }

    window.handleLogout = function() {
        if (confirm("Are you sure you want to log out?")) {
            if (window.clearAuth) window.clearAuth();
            window.location.href = "login.html";
        }
    };

    function injectBottomNav() {
        if (document.getElementById('mobile-bottom-nav')) return;
        
        const nav = document.createElement('nav');
        nav.id = 'mobile-bottom-nav';
        nav.className = 'mobile-bottom-nav';
        
        const currentPath = window.location.pathname.split('/').pop() || 'index.html';
        const isAuth = typeof getAuthToken !== 'undefined' && getAuthToken();
        
        nav.innerHTML = `
            <a href="browse.html" class="bottom-nav-item ${currentPath==='browse.html'?'active':''}">
                <i data-lucide="compass"></i>
                <span>Explore</span>
            </a>
            <a href="dashboard.html" class="bottom-nav-item ${currentPath==='dashboard.html'?'active':''}">
                <i data-lucide="layout-dashboard"></i>
                <span>Dash</span>
            </a>
            <a href="sell.html" class="bottom-nav-item sell-btn-nav">
                <div class="sell-fab">
                    <i data-lucide="plus"></i>
                </div>
            </a>
            <a href="chatlist.html" class="bottom-nav-item ${currentPath==='chatlist.html'?'active':''}">
                <i data-lucide="message-square"></i>
                <span>Inbox</span>
            </a>
            <a href="${isAuth ? 'profile.html' : 'login.html'}" class="bottom-nav-item ${currentPath==='profile.html'?'active':''}">
                <i data-lucide="user"></i>
                <span>${isAuth ? 'Profile' : 'Login'}</span>
            </a>
        `;
        document.body.appendChild(nav);
        if (window.lucide) window.lucide.createIcons();
    }

    function injectPWA() {
        if (!document.querySelector('link[rel="manifest"]')) {
            const manifest = document.createElement('link');
            manifest.rel = 'manifest';
            manifest.href = 'manifest.json';
            document.head.appendChild(manifest);
        }
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('sw.js').catch(() => {});
            });
        }
        
        // 5. App Features: Analytics Tracking & Push Notifications Hook
        console.log(`[Analytics] Tracked Page View: ${window.location.pathname}`);
        if ('Notification' in window && Notification.permission !== 'denied') {
            setTimeout(() => {
                Notification.requestPermission().then(p => {
                    if(p === 'granted') console.log('[Push] Notifications active.');
                });
            }, 5000);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            injectSplashScreen();
            injectNavbar();
            injectFooter();
            injectBottomNav();
            injectPWA();
            setTimeout(injectCookieConsent, 2000);
        });
    } else {
        injectSplashScreen();
        injectNavbar();
        injectFooter();
        injectBottomNav();
        injectPWA();
        setTimeout(injectCookieConsent, 2000);
    }
})();
