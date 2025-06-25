// scripts/vendor-puppeteer.js
import fs from 'node:fs';
import path from 'node:path';

console.log('--- Starting Puppeteer dependency vendoring script ---');

// 我们的 API 路由源文件目录
const apiDir = path.join(process.cwd(), 'pages', 'api');

// 将要“注入”的依赖包
const packagesToVendor = [
  '@sparticuz/chromium',
  'puppeteer-extra',
  'puppeteer-extra-plugin-stealth',
];

packagesToVendor.forEach(pkg => {
  // 源目录：项目根目录的 node_modules
  const sourceDir = path.join(process.cwd(), 'node_modules', pkg);
  // 目标目录：API 目录下的 node_modules
  const destDir = path.join(apiDir, 'node_modules', pkg);

  if (!fs.existsSync(sourceDir)) {
    console.warn(`Warning: Source package not found at "${sourceDir}". Skipping.`);
    return;
  }
  
  try {
    // 强制清空并重新创建目标目录
    fs.rmSync(destDir, { recursive: true, force: true });
    fs.mkdirSync(destDir, { recursive: true });
    
    // 复制整个包
    fs.cpSync(sourceDir, destDir, { recursive: true });
    console.log(`Successfully vendored ${pkg}`);
  } catch (err) {
    console.error(`Error vendoring ${pkg}: ${err}`);
    process.exit(1);
  }
});

console.log('--- Puppeteer dependency vendoring finished ---');
