const fs = require('fs');
const path = require('path');

const dir = './';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));

files.forEach(file => {
  let content = fs.readFileSync(path.join(dir, file), 'utf8');
  let changed = false;

  // Add lang="en" to html tag if missing
  if (content.includes('<html>')) {
    content = content.replace('<html>', '<html lang="en">');
    changed = true;
  }

  // Ensure all <img> tags have an alt attribute
  // Basic regex for img tags without alt
  const imgRegex = /<img\s+(?![^>]*alt=)([^>]+)>/ig;
  if (imgRegex.test(content)) {
    content = content.replace(imgRegex, '<img $1 alt="Image">');
    changed = true;
  }

  // Ensure all <img> tags have loading="lazy" (unless it's a critical logo, but adding it universally is decent for performance. Better yet, only add if missing)
  const imgLazyRegex = /<img\s+(?![^>]*loading=)([^>]+)>/ig;
  if (imgLazyRegex.test(content)) {
    content = content.replace(imgLazyRegex, '<img $1 loading="lazy">');
    changed = true;
  }

  // Look for buttons without aria-label and no visible text (just icons)
  // This is harder via regex, but let's just make sure input type="number" has aria-label or associated label.
  
  if (changed) {
    fs.writeFileSync(path.join(dir, file), content);
    console.log('Fixed A11y & Perf for', file);
  }
});
