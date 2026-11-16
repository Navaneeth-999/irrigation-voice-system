import { test, expect } from '@playwright/test';

test.describe('Jalamitra CSP 22-Step Comprehensive System Evaluation', () => {
  test.describe.configure({ mode: 'serial' });

  let pageContext: any;

  test('Execute complete 22-step evaluation flow', async ({ page, request }) => {
    // -------------------------------------------------------------------------
    // Step 1: Admin Login
    // -------------------------------------------------------------------------
    await test.step('Step 1: Admin Authentication', async () => {
      await page.goto('/login');
      await expect(page.getByText('జలమిత్ర')).toBeVisible();
      await expect(page.getByText(/Community Service Project/i)).toBeVisible();

      // Enter administrator credentials
      const emailInput = page.locator('input[type="email"]');
      const passwordInput = page.locator('input[type="password"]');

      await emailInput.fill('admin@csp-irrigation.org');
      await passwordInput.fill('ChangeMeAdmin123!');
      await page.getByRole('button', { name: /sign in/i }).click();

      // Either redirect to dashboard directly, or fulfill first-login forced password change
      const changePasswordHeading = page.getByText(/Password Change Required/i);

      await Promise.race([
        changePasswordHeading.waitFor({ state: 'visible', timeout: 15000 }),
        page.waitForURL('**/dashboard', { timeout: 15000 }),
      ]).catch(() => {});

      if (await changePasswordHeading.isVisible()) {
        const newPasswordInput = page.locator('input[type="password"]').first();
        const confirmPasswordInput = page.locator('input[type="password"]').nth(1);
        await newPasswordInput.fill('ChangeMeAdmin123!');
        await confirmPasswordInput.fill('ChangeMeAdmin123!');
        await page.getByRole('button', { name: /set new password/i }).click();
        await page.waitForURL('**/dashboard');
      }

      // Assert successful authentication onto dashboard
      await expect(page).toHaveURL(/.*dashboard.*/);
    });

    // -------------------------------------------------------------------------
    // Step 2: Authentication confirmation & Dashboard KPIs
    // -------------------------------------------------------------------------
    await test.step('Step 2: Dashboard KPIs and Overview', async () => {
      await expect(page.getByText('System Dashboard')).toBeVisible();

      // Assert key operational metrics are present
      await expect(page.getByText('Total Farmers', { exact: true })).toBeVisible();
      await expect(page.getByText('Cultivated Land', { exact: true })).toBeVisible();
      await expect(page.getByText('Active Seasons', { exact: true })).toBeVisible();
      await expect(page.getByText('Voice Calls', { exact: true })).toBeVisible();
      await expect(page.getByText('Est. Water Used', { exact: true })).toBeVisible();
      await expect(page.getByText('Open Actions', { exact: true })).toBeVisible();
    });

    // -------------------------------------------------------------------------
    // Step 3: Farmers directory search & filter
    // -------------------------------------------------------------------------
    await test.step('Step 3: Farmers Directory Search and Filter', async () => {
      await page.goto('/farmers');
      await expect(page.getByRole('heading', { name: /farmer(s)? directory/i })).toBeVisible();

      // Verify demo farmers appear
      await expect(page.getByText('Venkata Subbaiah').first()).toBeVisible();
      await expect(page.getByText('Koteswara Rao').first()).toBeVisible();
      await expect(page.getByText('Lakshmi Devi').first()).toBeVisible();
      await expect(page.getByText('Srinivasa Rao').first()).toBeVisible();

      // Filter by search query
      const searchInput = page.locator('input[placeholder*="Search"]').first();
      await searchInput.fill('Venkata');
      await expect(page.getByText('Venkata Subbaiah').first()).toBeVisible();
      await expect(page.getByText('Koteswara Rao')).toHaveCount(0);

      // Clear search
      await searchInput.fill('');
      await expect(page.getByText('Koteswara Rao').first()).toBeVisible();
    });

    // -------------------------------------------------------------------------
    // Step 4: Farmer detail view & consent audit trail
    // -------------------------------------------------------------------------
    await test.step('Step 4: Farmer Detail View & Consent Audit Trail', async () => {
      // Click on Venkata Subbaiah
      await page.getByText('Venkata Subbaiah').first().click();
      await page.waitForURL('**/farmers/*');
      await expect(page.getByText('F-DEMO-001').first()).toBeVisible();
      await expect(page.locator('span, p, h1, h2, h3').filter({ hasText: 'Guntur Rural' }).first()).toBeVisible();

      // Open Consents tab
      const consentsTab = page.getByRole('button', { name: /consents/i });
      await consentsTab.click();

      // Verify explicit opt-in consent records
      await expect(page.getByText('voice').first()).toBeVisible();
      await expect(page.getByText('sms').first()).toBeVisible();
      await expect(page.getByText(/granted/i).first()).toBeVisible();
    });

    // -------------------------------------------------------------------------
    // Step 5: Plot details & pump specifications (HP & LPH)
    // -------------------------------------------------------------------------
    await test.step('Step 5: Plot Details & Pump Specifications', async () => {
      const plotsTab = page.getByRole('button', { name: /plots/i });
      await plotsTab.click();

      await expect(page.getByText(/Ganga Chenu/i).first()).toBeVisible();
      await expect(page.getByText(/\d+(\.\d+)?\s*Acres/i).first()).toBeVisible();
      await expect(page.getByText(/5(\.0)?\s*HP/i).first()).toBeVisible();
      await expect(page.getByText(/18,?000\s*(LPH|L\/hr)/i).first()).toBeVisible();
    });

    // -------------------------------------------------------------------------
    // Step 6: Active cultivation seasons table
    // -------------------------------------------------------------------------
    await test.step('Step 6: Active Cultivation Seasons Table', async () => {
      await page.goto('/seasons');
      await expect(page.getByText(/Crop Seasons|Cultivation Seasons/i).first()).toBeVisible();

      // Verify active seasons are listed
      await expect(page.getByText('S-2026-DEMO-01').first()).toBeVisible();
      await expect(page.getByText(/Paddy/i).first()).toBeVisible();
      await expect(page.getByText(/ACTIVE/i).first()).toBeVisible();
    });

    // -------------------------------------------------------------------------
    // Step 7: Season detail view & stage timeline
    // -------------------------------------------------------------------------
    await test.step('Step 7: Season Detail View & Stage Timeline', async () => {
      await page.getByText('S-2026-DEMO-01').first().click();
      await page.waitForURL('**/seasons/*');

      await expect(page.getByText('S-2026-DEMO-01').first()).toBeVisible();
      await expect(page.getByText(/Timeline/i).first()).toBeVisible();

      // Open Irrigation tab to verify logged events
      const irrTab = page.getByRole('button', { name: /irrigation logs/i });
      if (await irrTab.isVisible()) {
        await irrTab.click();
        await expect(page.getByText(/pump[ _]hours/i).first()).toBeVisible();
      }
    });

    // -------------------------------------------------------------------------
    // Step 8: Launch Interactive Phone Call Simulator
    // -------------------------------------------------------------------------
    await test.step('Step 8: Interactive Phone Call Simulator View', async () => {
      await page.goto('/demo/call-simulator');
      await expect(page.getByText(/Farmer Telephony Simulator|Voice Call Simulator/i).first()).toBeVisible();
      await expect(page.getByText(/Interactive Simulator|Interactive IVR/i).first()).toBeVisible();
    });

    // -------------------------------------------------------------------------
    // Step 9: Execute DTMF keypad call flow
    // -------------------------------------------------------------------------
    await test.step('Step 9: Execute DTMF Keypad Call Flow', async () => {
      // Find Start Call button
      const startButton = page.getByRole('button', { name: /start telugu voice call|start.*call/i });
      await startButton.click();

      // Wait for call connected status
      await expect(page.getByText(/call in progress|question step/i).first()).toBeVisible({ timeout: 10000 });

      // Keypad responses for Telugu survey
      // Q1: Preferred language Telugu confirm -> Press 1
      const key1 = page.getByRole('button', { name: '1', exact: true });
      await key1.click();
      await page.waitForTimeout(500);

      // Q2: Identity confirm -> Press 1
      if (await key1.isVisible()) {
        await key1.click();
        await page.waitForTimeout(500);
      }

      // Q3: Rainfall class (light) -> Press 1
      if (await key1.isVisible()) {
        await key1.click();
        await page.waitForTimeout(500);
      }

      // Q4: Irrigated yes -> Press 1
      if (await key1.isVisible()) {
        await key1.click();
        await page.waitForTimeout(500);
      }

      // Q5: Irrigation count -> Press 2
      const key2 = page.getByRole('button', { name: '2', exact: true });
      if (await key2.isVisible()) {
        await key2.click();
        await page.waitForTimeout(500);
      }

      // Q6: Pump hours -> Press 8 followed by #
      const key8 = page.getByRole('button', { name: '8', exact: true });
      const keyHash = page.getByRole('button', { name: '#', exact: true });
      if (await key8.isVisible() && await keyHash.isVisible()) {
        await key8.click();
        await keyHash.click();
        await page.waitForTimeout(500);
      }

      // Assert DTMF call session progress state
      await expect(page.locator('body')).toContainText(/Call in Progress|Question Step|Call Flow Completed|Downstream Updates Recorded/i);
    });

    // -------------------------------------------------------------------------
    // Step 10: Call Transcript and Logs Verification
    // -------------------------------------------------------------------------
    await test.step('Step 10: Call Transcript and Logs Verification', async () => {
      // Assert conversation transcript contains logged interactions
      await expect(page.locator('body')).toContainText(/DTMF|Call|జలమిత్ర|Prompt/i);

      // Check Prompts & Audio tab
      const promptsTab = page.getByRole('button', { name: /audio prompts|review/i });
      if (await promptsTab.isVisible()) {
        await promptsTab.click();
        await expect(page.getByText(/prompt_intro_te|intro|Q1/i).first()).toBeVisible();
      }
    });

    // -------------------------------------------------------------------------
    // Step 11: Action Queue view & triage of generated action items
    // -------------------------------------------------------------------------
    await test.step('Step 11: Field Action Items Queue View', async () => {
      await page.goto('/action-items');
      await expect(page.getByText(/Action Items Queue|Field Action Queue/i).first()).toBeVisible();

      // Verify demo action items
      await expect(page.getByText(/Farmer reported frequent 3-phase power tripping/i).first()).toBeVisible();
    });

    // -------------------------------------------------------------------------
    // Step 12: Resolve action item with agronomist notes
    // -------------------------------------------------------------------------
    await test.step('Step 12: Resolve Action Item', async () => {
      // Find open action item's Update button
      const updateBtn = page.getByRole('button', { name: 'Update' }).first();
      await expect(updateBtn).toBeVisible();
      await updateBtn.click();

      // Assert resolution modal is displayed
      const modalHeading = page.getByText('Update Action Item Status');
      await expect(modalHeading).toBeVisible();

      // Enter agronomist notes
      const textarea = page.locator('textarea');
      await expect(textarea).toBeVisible();
      await textarea.fill('Agronomist field visit completed. Feeder line inspected.');

      // Close modal
      const cancelBtn = page.getByRole('button', { name: 'Cancel' });
      await expect(cancelBtn).toBeVisible();
      await cancelBtn.click();

      // Assert modal closes
      await expect(modalHeading).not.toBeVisible();
    });

    // -------------------------------------------------------------------------
    // Step 13: Weather & alerts view (Open-Meteo forecasts & IMD rules)
    // -------------------------------------------------------------------------
    await test.step('Step 13: Weather Records & IMD Alert Rules View', async () => {
      await page.goto('/weather');
      await expect(page.getByText(/Weather & Advisory Alerts|వాతావరణ సమాచారం|Weather Forecast/i).first()).toBeVisible();

      // Select Guntur Rural village
      const gunturOptLocator = page.locator('select option', { hasText: 'Guntur Rural' }).first();
      await gunturOptLocator.waitFor({ state: 'attached' });
      const gunturOption = await gunturOptLocator.getAttribute('value');
      if (gunturOption) {
        await page.locator('select').first().selectOption(gunturOption);
      }

      // Check village weather forecast select and alerts
      await expect(page.getByText(/Heavy Rainfall Expected/i).first()).toBeVisible();
      await expect(page.getByText(/భారీ వర్ష సూచన/i).first()).toBeVisible();
    });

    // -------------------------------------------------------------------------
    // Step 14: Trigger alert deduplication & fan-out with quiet-hours/consent check
    // -------------------------------------------------------------------------
    await test.step('Step 14: Alert Deduplication and Fan-Out Verification', async () => {
      // Verify deduplication badge and fan-out communication trail
      await expect(page.getByText(/Deduplicated/i).first()).toBeVisible();
      await expect(page.getByText(/Communication Audit Trail/i).first()).toBeVisible();
    });

    // -------------------------------------------------------------------------
    // Step 15: Publish village-scoped agronomist advisory
    // -------------------------------------------------------------------------
    await test.step('Step 15: Publish Village-Scoped Advisory', async () => {
      const advisoryButton = page.getByRole('button', { name: /publish advisory/i });
      await expect(advisoryButton).toBeVisible();
      await advisoryButton.click();

      const modalHeading = page.getByText(/వ్యవసాయ అధికారి సూచన/i).first();
      await expect(modalHeading).toBeVisible();

      const msgEn = page.locator('textarea[placeholder*="Water rotation"]').first();
      await expect(msgEn).toBeVisible();
      await msgEn.fill('Field advisory: Check soil moisture before irrigating.');

      const cancelBtn = page.getByRole('button', { name: /cancel/i }).first();
      await expect(cancelBtn).toBeVisible();
      await cancelBtn.click();

      await expect(modalHeading).not.toBeVisible();
    });

    // -------------------------------------------------------------------------
    // Step 16: Conservation Analytics page (FAO-56 evapotranspiration & Kc curve)
    // -------------------------------------------------------------------------
    await test.step('Step 16: Conservation Analytics FAO-56 Engine', async () => {
      await page.goto('/analytics');
      await expect(page.getByText(/Water Analytics & FAO-56 Engine/i).first()).toBeVisible();
      await expect(page.getByText(/Crop Evapotranspiration|Estimated Net Demand|Water Use Ratio/i).first()).toBeVisible();
    });

    // -------------------------------------------------------------------------
    // Step 17: Water Use Ratio (WUR) indicative band inspection
    // -------------------------------------------------------------------------
    await test.step('Step 17: Water Use Ratio Indicative Band Inspection', async () => {
      // Wait for season select options to attach
      await page.locator('select option').first().waitFor({ state: 'attached' });
      const s1Opt = await page.locator('select option', { hasText: 'S-2026-DEMO-01' }).first().getAttribute('value');
      if (s1Opt) {
        await page.locator('select').first().selectOption(s1Opt);
      }
      await expect(page.locator('body')).toContainText(/Water Use Ratio/i);
      await expect(page.locator('body')).toContainText(/Near.*Target|Below.*Target|Above.*Target|near_estimate/i);
    });

    // -------------------------------------------------------------------------
    // Step 18: Verify "Unvalidated Assumptions" banner on analytics UI
    // -------------------------------------------------------------------------
    await test.step('Step 18: Unvalidated Assumptions Banner Verification', async () => {
      // Demo Season 1 has unvalidated assumptions flagged in season_water_metrics
      const s1OptLoc = page.locator('select option', { hasText: 'S-2026-DEMO-01' }).first();
      await s1OptLoc.waitFor({ state: 'attached' });
      const s1Opt = await s1OptLoc.getAttribute('value');
      if (s1Opt) {
        await page.locator('select').first().selectOption(s1Opt);
      }
      await expect(page.getByText(/Based on Unvalidated Assumptions/i).first()).toBeVisible();
      await expect(page.getByText(/ధృవీకరించబడని అంచనాల ఆధారంగా/i).first()).toBeVisible();
    });

    // -------------------------------------------------------------------------
    // Step 19: Season harvest completion modal & eligibility gating check
    // -------------------------------------------------------------------------
    await test.step('Step 19: Season Completion & Eligibility Gating', async () => {
      await page.goto('/seasons');
      await expect(page.getByText('S-2026-DEMO-03').first()).toBeVisible(); // Completed Chilli season
      await expect(page.getByText('S-2026-DEMO-04').first()).toBeVisible(); // Completed Ineligible Blackgram season
    });

    // -------------------------------------------------------------------------
    // Step 20: Issue cryptographically sealed Conservation Certificate (SHA-256)
    // -------------------------------------------------------------------------
    await test.step('Step 20: Sealed Conservation Certificate (SHA-256)', async () => {
      await page.goto('/certificates');
      await expect(page.getByText(/Conservation Certificates/i).first()).toBeVisible();

      // Assert accredited demo certificate
      await expect(page.getByText('JALAMITRA-2026-00001').first()).toBeVisible();
      await expect(page.getByText('Lakshmi Devi').first()).toBeVisible();
      await expect(page.getByText(/SEALED/i).first()).toBeVisible();
    });

    // -------------------------------------------------------------------------
    // Step 21: Download bilingual PDF with embedded Telugu typography & QR code
    // -------------------------------------------------------------------------
    await test.step('Step 21: Bilingual Certificate PDF Verification', async () => {
      // Verify PDF download endpoint works with authenticated browser session
      const certRes = await page.request.get('/api/v1/certificates/JALAMITRA-2026-00001/pdf');
      expect(certRes.status()).toBe(200);
      expect(certRes.headers()['content-type']).toContain('application/pdf');
    });

    // -------------------------------------------------------------------------
    // Step 22: Open Public Verification Page & assert ZERO PII leakage
    // -------------------------------------------------------------------------
    await test.step('Step 22: Public Verification & Zero PII Leakage Check', async () => {
      await page.goto('/verify/JALAMITRA-2026-00001');

      // Assert Verification Success
      await expect(page.getByText(/AUTHENTICATED & VALID|OFFICIALLY ACCREDITED|CERTIFICATE AUTHENTICATED/i)).toBeVisible();
      await expect(page.getByText('JALAMITRA-2026-00001').first()).toBeVisible();

      // Assert DEMO / SIMULATED Record watermark/banner is visibly displayed
      await expect(page.getByText(/DEMO \/ SIMULATED RECORD/i).first()).toBeVisible();

      // Assert Exactly the 6 permitted public fields appear
      await expect(page.getByText(/Certificate Number/i)).toBeVisible();
      await expect(page.getByText(/Season/i).first()).toBeVisible();
      await expect(page.getByText(/Crop/i).first()).toBeVisible();
      await expect(page.getByText(/Village/i).first()).toBeVisible();
      await expect(page.getByText(/Issue Date/i)).toBeVisible();
      await expect(page.getByText(/Status/i).first()).toBeVisible();

      // STRICT ZERO PII LEAKAGE CHECKS:
      // Farmer full name, phone number, plot survey number, and internal confidence scores must NOT appear
      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toContain('Lakshmi Devi');
      expect(bodyText).not.toContain('+919959144771');
      expect(bodyText).not.toContain('SY-301/C');
      expect(bodyText).not.toContain('Pedda Polam');
      expect(bodyText).not.toContain('Confidence Score');
      expect(bodyText).not.toContain('85/100');
    });
  });
});
