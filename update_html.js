const fs = require('fs');
const path = require('path');

const dir = './';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));

files.forEach(file => {
    let content = fs.readFileSync(path.join(dir, file), 'utf8');
    let changed = false;

    // 1. Inject components.js script before </body>
    if (!content.includes('src="components.js"')) {
        content = content.replace('</body>', '    <script src="components.js"></script>\n</body>');
        changed = true;
    }

    // 2. Ensure navbar div has nothing but the placeholder if we are using components.js to inject it
    // Actually, keep it as is, components.js will overwrite the innerHTML.
    
    // 3. Fix potential relative path issues for logo.png in subdirectories?
    // Project is flat, so no issue.

    if (changed) {
        fs.writeFileSync(path.join(dir, file), content);
    }
});
