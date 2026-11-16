import { test, expect } from '@playwright/test';
import * as path from 'path';

const SCREENSHOT_DIR = 'C:/Users/navan/.gemini/antigravity/brain/8bea8019-91f3-4656-a5a0-a8b363690dd6/screenshots';

test.describe('Complete 6-Module Functional Verification and Screenshot Capture', () => {
  test.describe.configure({ mode: 'serial' });

  test('Login and verify all 6 restored modules with zero placeholders', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // Step 1: Admin Authentication
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]');
    await emailInput.fill('admin@csp-irrigation.org');
    await passwordInput.fill('ChangeMeAdmin123!');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Check if password change required
    const changePasswordHeading = page.getByText(/Password Change Required/i);
    try {
      await Promise.race([
        changePasswordHeading.waitFor({ state: 'visible', timeout: 5000 }),
        page.waitForURL('**/dashboard', { timeout: 8000 }),
      ]);
    } catch (e) {
      // Continue
    }

    if (await changePasswordHeading.isVisible()) {
      const newPasswordInput = page.locator('input[type="password"]').first();
      const confirmPasswordInput = page.locator('input[type="password"]').nth(1);
      await newPasswordInput.fill('ChangeMeAdmin123!');
      await confirmPasswordInput.fill('ChangeMeAdmin123!');
      await page.getByRole('button', { name: /set new password/i }).click();
      await page.waitForURL('**/dashboard', { timeout: 10000 });
    }

    await expect(page).toHaveURL(/.*dashboard.*/);
    console.log('✓ Admin authenticated successfully onto dashboard');

    const assertNoPlaceholder = async (moduleName: string) => {
      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toContain('Module Scheduled in Phase');
      expect(bodyText).not.toContain('Module Scheduled in Admin Core');
      console.log(`✓ Confirmed NO placeholder on ${moduleName}`);
    };

    // -------------------------------------------------------------
    // Module 1: Call Simulator (/demo/call-simulator)
    // -------------------------------------------------------------
    console.log('\n--- Verifying Module 1: Call Simulator ---');
    await page.goto('/demo/call-simulator');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    await assertNoPlaceholder('Call Simulator');
    await expect(page.locator('body')).toContainText(/Call Simulator|Telugu Voice|Simulate Call|IVR/i);
    
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'screenshot_call_simulator.png'),
      fullPage: true,
    });
    console.log('✓ Captured screenshot_call_simulator.png');

    // -------------------------------------------------------------
    // Module 2: Weather & Alerts (/weather)
    // -------------------------------------------------------------
    console.log('\n--- Verifying Module 2: Weather & Alerts ---');
    await page.goto('/weather');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await assertNoPlaceholder('Weather & Alerts');
    await expect(page.locator('body')).toContainText(/Weather|Forecast|Alerts|Rainfall|Humidity|Temperature/i);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'screenshot_weather_alerts.png'),
      fullPage: true,
    });
    console.log('✓ Captured screenshot_weather_alerts.png');

    // -------------------------------------------------------------
    // Module 3: Water Analytics (/analytics)
    // -------------------------------------------------------------
    console.log('\n--- Verifying Module 3: Water Analytics ---');
    await page.goto('/analytics');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await assertNoPlaceholder('Water Analytics');
    await expect(page.locator('body')).toContainText(/Water Analytics|Water Use Ratio|Conservation|Savings|Efficiency|FAO-56/i);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'screenshot_water_analytics.png'),
      fullPage: true,
    });
    console.log('✓ Captured screenshot_water_analytics.png');

    // -------------------------------------------------------------
    // Module 4: Certificates (/certificates)
    // -------------------------------------------------------------
    console.log('\n--- Verifying Module 4: Certificates ---');
    await page.goto('/certificates');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await assertNoPlaceholder('Certificates');
    await expect(page.locator('body')).toContainText(/Certificate|Water Conservation|Accreditation|Issued|Verified/i);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'screenshot_certificates.png'),
      fullPage: true,
    });
    console.log('✓ Captured screenshot_certificates.png');

    // -------------------------------------------------------------
    // Module 5: Settings (/settings)
    // -------------------------------------------------------------
    console.log('\n--- Verifying Module 5: Settings ---');
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await assertNoPlaceholder('Settings');
    await expect(page.locator('body')).toContainText(/System Configuration|Settings|Threshold|Parameters|Telephony/i);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'screenshot_settings.png'),
      fullPage: true,
    });
    console.log('✓ Captured screenshot_settings.png');

    // -------------------------------------------------------------
    // Module 6: Audit Logs (/audit)
    // -------------------------------------------------------------
    console.log('\n--- Verifying Module 6: Audit Logs ---');
    await page.goto('/audit');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await assertNoPlaceholder('Audit Logs');
    await expect(page.locator('body')).toContainText(/Audit Logs|Append-Only|Tamper|Records|Action|Timestamp/i);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'screenshot_audit_logs.png'),
      fullPage: true,
    });
    console.log('✓ Captured screenshot_audit_logs.png');

    console.log('\n🎉 ALL 6 MODULES SUCCESSFULLY VERIFIED WITH ZERO PLACEHOLDERS AND CAPTURED SCREENSHOTS!');
  });
});
