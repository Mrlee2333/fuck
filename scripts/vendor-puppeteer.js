// scripts/vendor-puppeteer.js
import fs from 'fs-extra'; // 【修复】导入 fs-extra 模块
import path from 'node:path';

console.log('--- Starting Puppeteer dependency vendoring script (using fs-extra) ---');

const packagesToVendor = [
  '@sparticuz/chromium',
  'puppeteer-extra',
  'puppeteer-extra-plugin-stealth',
];

packagesToVendor.forEach(pkg => {
  const sourceDir = path.join(process.cwd(), 'node_modules', pkg);
  const destDir = path.join(process.cwd(), 'pages', 'api', 'node_modules', pkg);

  if (!fs.existsSync(sourceDir)) {
    console.warn(`Warning: Source package not found: "${sourceDir}". Skipping.`);
    return;
  }

  try {
    // 【修复】使用 fs-extra 的 copySync。它会自动处理目录创建、清理和符号链接。
    fs.copySync(sourceDir, destDir);
    console.log(`Successfully vendored ${pkg} with fs-extra.`);
  } catch (err) {
    console.error(`Error vendoring ${pkg}: ${err}`);
    process.exit(1);
  }
});

console.log('--- Puppeteer dependency vendoring finished ---');
