// scripts/download-chrome.js
import { install, canDownload } from '@puppeteer/browsers';
import path from 'node:path';

const chromeBuildId = '1135525'; 
const cacheDir = path.join(process.cwd(), '.local-chromium');

async function downloadChrome() {
  console.log(`--- Starting Chrome v${chromeBuildId} download ---`);
  try {
    const isDownloadable = await canDownload({
      browser: 'chrome',
      buildId: chromeBuildId,
      cacheDir: cacheDir,
      platform: 'linux',
    });

    if (!isDownloadable) {
      console.log(`Chrome v${chromeBuildId} is already installed. Skipping download.`);
      return;
    }

    await install({
      browser: 'chrome',
      buildId: chromeBuildId,
      cacheDir: cacheDir,
      platform: 'linux',
    });
    console.log(`--- Chrome v${chromeBuildId} downloaded successfully to ${cacheDir} ---`);
  } catch (error) {
    console.error('Error downloading Chrome:', error);
    process.exit(1);
  }
}

downloadChrome();
