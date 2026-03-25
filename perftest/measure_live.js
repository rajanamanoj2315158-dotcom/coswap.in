const puppeteer = require('puppeteer-core');

(async () => {
    console.log("\n🚀 Initiating connection to https://coswap.in...");
    let browser;
    try {
        browser = await puppeteer.launch({ 
            executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            headless: "new"
        });
    } catch (e) {
        console.error("Could not launch Chrome. Ensure it is installed in Applications:", e.message);
        process.exit(1);
    }
    const page = await browser.newPage();
    
    // Attempt to bypass simple bot detection
    await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36");

    console.log("⏱️  Starting live timer...");
    const startTime = Date.now();
    let timer = setInterval(() => {
        process.stdout.write(`\r[Timer] ${((Date.now() - startTime)/1000).toFixed(1)}s elapsed...`);
    }, 100); 

    try {
        await page.evaluateOnNewDocument(() => {
            window.lcp = 0;
            new PerformanceObserver((entryList) => {
                const entries = entryList.getEntries();
                if (entries.length > 0) {
                    const lastEntry = entries[entries.length - 1];
                    window.lcp = lastEntry.renderTime || lastEntry.loadTime;
                }
            }).observe({type: 'largest-contentful-paint', buffered: true});
        });

        await page.goto('https://coswap.in', { waitUntil: 'networkidle0', timeout: 90000 });
        
        await new Promise(r => setTimeout(r, 1000));

        const metrics = await page.evaluate(() => {
            const timing = performance.getEntriesByType('navigation')[0];
            const paint = performance.getEntriesByType('paint');
            const fcpEntry = paint.find(p => p.name === 'first-contentful-paint');
            
            return {
                ttfb: timing ? timing.responseStart - timing.startTime : 0,
                fcp: fcpEntry ? fcpEntry.startTime : null,
                lcp: window.lcp || null,
                interactive: timing ? timing.domInteractive : 0
            };
        });

        clearInterval(timer);
        const totalLoad = ((Date.now() - startTime)/1000).toFixed(2);
        process.stdout.write(`\r✅ [Timer] Stopped at ${totalLoad}s                \n\n`);
        
        console.log(`📊 PERFORMANCE REPORT FOR https://coswap.in`);
        console.log(`-------------------------------------------`);
        console.log(`Time to First Byte (TTFB):   ${(metrics.ttfb / 1000).toFixed(2)}s`);
        console.log(`First Contentful Paint:      ${metrics.fcp ? (metrics.fcp / 1000).toFixed(2) + 's' : 'N/A'}`);
        console.log(`Largest Contentful Paint:    ${metrics.lcp ? (metrics.lcp / 1000).toFixed(2) + 's' : 'N/A'}`);
        console.log(`Dom Interactive:             ${(metrics.interactive / 1000).toFixed(2)}s`);
        console.log(`Total Load Time (Idle):      ${totalLoad}s`);
        console.log(`-------------------------------------------`);

        if (metrics.ttfb > 1000) {
            console.log(`\n🚨 RENDERING / SERVER DELAY DETECTED!`);
            console.log(`The server took ${(metrics.ttfb/1000).toFixed(1)} seconds to send the first byte of data.`);
            console.log(`This confirms the Render.com free-tier 'sleeping server' issue. The frontend was stuck waiting on a blank screen or a rendering overlay.`);
        } else {
            console.log(`\n⚡ Server responded quickly! (Instance is currently awake).`);
        }

        if (metrics.lcp && metrics.lcp > 2500) {
            console.log(`\n⚠️ SLOW LCP DETECTED!`);
            console.log(`The Largest Contentful Paint took ${(metrics.lcp/1000).toFixed(1)} seconds.`);
            console.log(`This is likely due to the massive unoptimized logo.png blocking the paint pipeline.`);
        }
        
    } catch(err) {
        clearInterval(timer);
        console.log('\n❌ Error loading page:', err.message);
    }
    await browser.close();
})();
