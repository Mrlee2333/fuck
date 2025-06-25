// scripts/copy-files.js
import fs from 'node:fs';
import path from 'node:path';

const sourceDir = path.join('node_modules', 'header-generator', 'data_files');
const destDir = path.join('netlify', 'functions', 'data_files');

// 检查源目录是否存在
if (!fs.existsSync(sourceDir)) {
  console.error(`Error: Source directory not found at "${sourceDir}"`);
  console.error('Please ensure "header-generator" is installed correctly.');
  process.exit(1);
}

// 确保目标目录存在，如果不存在则创建
fs.mkdirSync(destDir, { recursive: true });

// 复制整个目录
try {
  fs.cpSync(sourceDir, destDir, { recursive: true });
  console.log(`Successfully copied ${sourceDir} to ${destDir}`);
} catch (err) {
  console.error(`Error copying files: ${err}`);
  process.exit(1);
}
