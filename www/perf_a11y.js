const fs = require('fs');
const path = require('path');

const dir = './';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));

files.forEach(file => {
  let content = fs.readFileSync(path.join(dir, file), 'utf8');
  let changed = false;

  // Performance: Preconnect to unpkg
  if (!content.includes('<link rel="preconnect" href="https://unpkg.com">') && content.includes('<head>')) {
    content = content.replace('<head>', '<head>\n    <link rel="preconnect" href="https://unpkg.com">');
    changed = true;
  }

  // A11y: Add focus states if missing, but css handles that. Let's add explicit 'tabindex="0"' to custom dropdowns
  if (content.includes('class="custom-select"') && !content.includes('tabindex="0"')) {
    content = content.replace('class="custom-select"', 'class="custom-select" tabindex="0"');
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(path.join(dir, file), content);
    console.log('Processed perf/a11y on', file);
  }
});
