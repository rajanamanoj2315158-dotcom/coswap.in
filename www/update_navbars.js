const fs = require('fs');
const path = require('path');

const dir = './';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));

files.forEach(file => {
    let content = fs.readFileSync(path.join(dir, file), 'utf8');
    let changed = false;

    // 1. Simplify navbar to a placeholder
    const navMatch = content.match(/<nav class="navbar">([\s\S]*?)<\/nav>/);
    if (navMatch) {
        content = content.replace(/<nav class="navbar">([\s\S]*?)<\/nav>/, '<nav class="navbar"></nav>');
        changed = true;
    }

    // 2. Remove mobile-nav blocks as they are being consolidated or handled by components.js
    // Actually components.js handles navbar, not mobile footer nav yet. 
    // But index.html/browse.html have mobile-nav. Let's keep those for now if they are useful.

    // 3. Ensure components.js is included
    if (!content.includes('src="components.js"')) {
        content = content.replace('</body>', '    <script src="components.js"></script>\n</body>');
        changed = true;
    }

    if (changed) {
        fs.writeFileSync(path.join(dir, file), content);
    }
});
