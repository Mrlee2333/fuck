// scripts/copy-vercel-files.js
import fs from 'node:fs';
import path from 'node:path';

console.log('--- Starting Vercel file copy script ---');

// Vercel 构建输出的函数目录，这是固定的
const vercelOutputDir = path.join(process.cwd(), '.vercel', 'output', 'functions');

// 检查 Vercel 的输出目录是否存在，如果不存在，说明脚本运行得太早，直接退出
if (!fs.existsSync(vercelOutputDir)) {
    console.log(`Vercel output directory not found. This script might be running before the build. Exiting gracefully.`);
    process.exit(0);
}

// 目标是 proxy.func 这个目录
const destFuncDir = path.join(vercelOutputDir, 'pages', 'api', 'proxy.func');

// 需要复制的依赖包
const packagesToCopy = [
  '@sparticuz/chromium',
  'puppeteer-extra-plugin-stealth'
];

packagesToCopy.forEach(pkg => {
  const sourceDir = path.join(process.cwd(), 'node_modules', pkg);
  
  // 【关键修复】我们不是复制到 proxy.func 根目录，而是复制到它里面的 node_modules 目录
  const destDir = path.join(destFuncDir, 'node_modules', pkg);

  if (!fs.existsSync(sourceDir)) {
    console.warn(`Warning: Source package directory not found at "${sourceDir}". Skipping.`);
    return;
  }
  
  try {
    // 【关键修复】在复制前，强制删除已存在的目标目录，防止 EEXIST 错误
    fs.rmSync(destDir, { recursive: true, force: true });
    
    // 确保目标目录的上层存在
    fs.mkdirSync(path.dirname(destDir), { recursive: true });

    // 重新复制
    fs.cpSync(sourceDir, destDir, { recursive: true });

    console.log(`Successfully (re)created and copied ${pkg} to destination.`);
  } catch (err) {
    console.error(`Error copying ${pkg}: ${err}`);
    process.exit(1);
  }
});

console.log('--- Vercel file copy script finished ---');
