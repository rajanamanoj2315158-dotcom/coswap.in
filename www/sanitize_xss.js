const fs = require('fs');
const path = require('path');

const dir = './';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));

files.forEach(file => {
  let content = fs.readFileSync(path.join(dir, file), 'utf8');
  let changed = false;

  // Extremely basic ast-like replacement for innerHTML = `...${var}...`
  // A safer Regex approach for the specific templates found:
  // e.g. ${c.title} -> ${escapeHtml(c.title)}
  // We'll replace all ${...} inside innerHTML with escapeHtml(...) 
  // unless it already has escapeHtml.
  
  // Actually, let's just do targeted replacements based on known templates
  const targets = [
    'c.title', 'c.category', 'c.details', 'c.seller_name', 'c.price', 'item.title', 'item.category', 
    'item.details', 'item.seller_name', 'coupon.title', 'coupon.category', 
    'r.coupon_title', 'r.buyer_name', 'r.seller_name', 'p.title', 'p.category', 'p.seller_name',
    't.coupon_title', 't.buyer_name', 't.seller_name', 't.last_message',
    'm.body', 'n.message'
  ];

  targets.forEach(t => {
    const raw = `\\$\\{(${t})\\}`;
    const escaped = `\\$\\{escapeHtml\\($1\\)\\}`;
    const re = new RegExp(raw, 'g');
    if (re.test(content)) {
      content = content.replace(re, `\${escapeHtml($1)}`);
      changed = true;
    }
    
    // Also handle possible property access like c.title || ''
    const rawWithOr = `\\$\\{(${t}\\s*\\|\\|\\s*['"].*?['"])\\}`;
    const escapedWithOr = `\\$\\{escapeHtml\\($1\\)\\}`;
    const reWithOr = new RegExp(rawWithOr, 'g');
    if (reWithOr.test(content)) {
      content = content.replace(reWithOr, `\${escapeHtml($1)}`);
      changed = true;
    }
  });

  if (changed) {
    fs.writeFileSync(path.join(dir, file), content);
    console.log('Sanitized', file);
  }
});
