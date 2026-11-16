import { chromium } from '@playwright/test';
import path from 'path';

async function main() {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  const pdfPath = path.resolve('../backend/test-output.pdf');
  const fileUrl = `file:///${pdfPath.replace(/\\/g, '/')}`;
  await page.goto(fileUrl, { waitUntil: 'load' });
  await page.waitForTimeout(3000);

  // In Chromium PDF viewer, text is in the embed or shadow DOM
  const title = await page.title();
  console.log('Page Title in Edge PDF Viewer:', title);

  await browser.close();
}

main().catch(console.error);
