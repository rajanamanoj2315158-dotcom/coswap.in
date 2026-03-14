const fs = require('fs');
const path = require('path');

const dir = './';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));

files.forEach(file => {
  let content = fs.readFileSync(path.join(dir, file), 'utf8');
  let changed = false;

  const targets = [
    'c.title', 'c.category', 'c.details', 'c.seller_name', 'c.price', 'item.title', 'item.category', 
    'item.details', 'item.seller_name', 'coupon.title', 'coupon.category', 
    'r.coupon_title', 'r.buyer_name', 'r.seller_name', 'p.title', 'p.category', 'p.seller_name',
    't.coupon_title', 't.buyer_name', 't.seller_name', 't.last_message',
    'm.body', 'n.message'
  ];

  targets.forEach(t => {
    // Match normal ${obj.prop}
    const raw1 = `\\$\\{${t.replace('.', '\\.')}\\}`;
    const escaped1 = `\\$\\{escapeHtml(${t})\\}`;
    const re1 = new RegExp(raw1, 'g');
    if (re1.test(content)) {
      content = content.replace(re1, escaped1);
      changed = true;
    }
    
    // Match ${obj.prop || "Default"}
    const raw2 = `\\$\\{${t.replace('.', '\\.')}\\s*\\|\\|\\s*(['"].*?['"])\\}`;
    const escaped2 = `\\$\\{escapeHtml(${t}) || $1\\}`;
    const re2 = new RegExp(raw2, 'g');
    if (re2.test(content)) {
      content = content.replace(re2, escaped2);
      changed = true;
    }
  });

  if (changed) {
    fs.writeFileSync(path.join(dir, file), content);
    console.log('Sanitized', file);
  }
});
