import { chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';

async function main() {
  const pdfPath = path.resolve('../backend/test-output.pdf');
  console.log('PDF Path:', pdfPath, 'Exists:', fs.existsSync(pdfPath));

  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Navigate to file URL
  const fileUrl = `file:///${pdfPath.replace(/\\/g, '/')}`;
  console.log('Navigating to:', fileUrl);
  await page.goto(fileUrl, { waitUntil: 'load' });
  await page.waitForTimeout(3000);

  const screenshotPath = path.resolve('../backend/pdf-screenshot.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log('Saved screenshot to:', screenshotPath, 'size:', fs.statSync(screenshotPath).size);

  await browser.close();
}

main().catch(console.error);
