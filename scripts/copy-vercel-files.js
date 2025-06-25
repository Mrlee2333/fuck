// scripts/copy-vercel-files.js
import fs from 'node:fs';
import path from 'node:path';

console.log('--- Starting Vercel file copy script ---');

// Vercel 构建输出的函数目录
const vercelOutputDir = path.join('.vercel', 'output', 'functions', 'pages', 'api');
// 我们将把所有需要的文件都复制到 proxy.func 目录中
const destDir = path.join(vercelOutputDir, 'proxy.func');

// 需要复制的依赖包及其内部资源
const packagesToCopy = [
  '@sparticuz/chromium',
  'puppeteer-extra-plugin-stealth'
];

// 确保目标目录存在
fs.mkdirSync(destDir, { recursive: true });

packagesToCopy.forEach(pkg => {
  // 注意：我们直接复制整个包，以确保所有内部文件都被包含
  const sourceDir = path.join('node_modules', pkg);
  const destPackageDir = path.join(destDir, 'node_modules', pkg);

  if (!fs.existsSync(sourceDir)) {
    console.warn(`Warning: Package directory not found at "${sourceDir}". Skipping.`);
    return;
  }
  
  try {
    fs.mkdirSync(destPackageDir, { recursive: true });
    fs.cpSync(sourceDir, destPackageDir, { recursive: true });
    console.log(`Successfully copied ${pkg} to destination.`);
  } catch (err) {
    console.error(`Error copying ${pkg}: ${err}`);
    process.exit(1);
  }
});

console.log('--- Vercel file copy script finished ---');
