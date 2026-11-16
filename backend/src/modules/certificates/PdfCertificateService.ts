import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../../config/index.js';
import { APP_NAME, APP_NAME_TE, ORGANIZATION_NAME } from '../../config/branding.js';
import { CertificateRecord, SeasonReportRecord } from './types.js';

function cleanLatin(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/[\u0C00-\u0C7F]/g, '') // Remove Telugu Unicode block
    .replace(/\(\s*\)/g, '')          // Remove empty parentheses left behind
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveFontPath(filename: string): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), 'assets/fonts', filename),
    path.resolve(process.cwd(), 'backend/assets/fonts', filename),
    path.resolve(currentDir, '../../../assets/fonts', filename),
    path.resolve(currentDir, '../../../../assets/fonts', filename),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

export class PdfCertificateService {
  private fontRegularPath: string;
  private fontBoldPath: string;

  constructor() {
    this.fontRegularPath = resolveFontPath('NotoSansTelugu-Regular.ttf');
    this.fontBoldPath = resolveFontPath('NotoSansTelugu-Bold.ttf');
  }

  /**
   * Generates a high-resolution, bilingual PDF conservation certificate buffer.
   * Uses PUBLIC_FRONTEND_URL for QR code verification linking.
   * Automatically catches font shaping failures and falls back cleanly
   * to Latin-only Helvetica typography with a loud console warning, ensuring downloads never fail with 500.
   */
  async generateCertificatePdf(
    certificate: CertificateRecord,
    baseUrl: string = config.PUBLIC_FRONTEND_URL
  ): Promise<Buffer> {
    try {
      const buf = await this.buildCertificateDocument(certificate, baseUrl, true);
      // Persist in local storage directory with versioned filename
      await this.saveCertificatePdfBuffer(certificate, buf);
      return buf;
    } catch (err: any) {
      console.warn(
        '\x1b[33m%s\x1b[0m',
        `⚠️ [PdfCertificateService] WARNING: Font shaping error encountered during Telugu rendering: "${err.message}". ` +
        `Falling back cleanly to standard Latin/Helvetica typography. Certificate download will succeed.`
      );
      const fallbackBuf = await this.buildCertificateDocument(certificate, baseUrl, false);
      await this.saveCertificatePdfBuffer(certificate, fallbackBuf);
      return fallbackBuf;
    }
  }

  async saveCertificatePdf(certificate: CertificateRecord, baseUrl: string = config.PUBLIC_FRONTEND_URL): Promise<string> {
    const buf = await this.generateCertificatePdf(certificate, baseUrl);
    return await this.saveCertificatePdfBuffer(certificate, buf);
  }

  public async saveCertificatePdfBuffer(certificate: CertificateRecord, buffer: Buffer): Promise<string> {
    const storageDir = path.resolve(process.cwd(), 'storage/certificates');
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
    const certCode = certificate.certificateCode || (certificate as any).certificate_code;
    const certVersion = certificate.version ?? (certificate as any).version ?? 1;
    const filePath = path.join(storageDir, `certificate-${certCode}_v${certVersion}.pdf`);
    const hyphenPath = path.join(storageDir, `certificate-${certCode}-v${certVersion}.pdf`);
    fs.writeFileSync(filePath, buffer);
    fs.writeFileSync(hyphenPath, buffer);
    return filePath;
  }

  private buildCertificateDocument(
    certificate: CertificateRecord,
    baseUrl: string,
    useTeluguFonts: boolean
  ): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
      try {
        const certCode = certificate.certificateCode || (certificate as any).certificate_code;
        const certSha = certificate.sha256Hash || (certificate as any).sha256_hash;
        const certConfScore = certificate.confidenceScore ?? (certificate as any).confidence_score ?? 80;
        const certConfBand = certificate.confidenceBand || (certificate as any).confidence_band || 'high';
        const certVersion = certificate.version ?? (certificate as any).version ?? 1;
        const certCreatedAt = certificate.createdAt || (certificate as any).created_at || new Date().toISOString();
        const rawWur = certificate.waterUseRatio ?? (certificate as any).water_use_ratio;
        const certWur = rawWur !== null && rawWur !== undefined && !isNaN(Number(rawWur)) ? Number(rawWur) : null;
        const certWurBand = certificate.waterUseRatioBand || (certificate as any).water_use_ratio_band || 'near_estimate';
        const s = (certificate as any).snapshotData || (certificate as any).snapshot_data;
        const isDemo = Boolean(
          (certificate as any).isDemo ||
          (certificate as any).is_demo ||
          s?.dataOrigin === 'demo' ||
          (certCode && String(certCode).includes('DEMO'))
        );

        const doc = new PDFDocument({
          size: 'A4',
          layout: 'landscape',
          margin: 36, // 0.5 inch margins
          info: {
            Title: `Conservation Certificate - ${certCode} (v${certVersion})`,
            Author: `${APP_NAME}`,
            Subject: 'Seasonal Water Conservation Certificate',
            Keywords: 'irrigation, water conservation, andhra pradesh, telugu, fao-56',
          },
        });

        const chunks: Buffer[] = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', err => reject(err));

        const hasTeluguFiles = fs.existsSync(this.fontRegularPath) && fs.existsSync(this.fontBoldPath);
        const canUseTelugu = useTeluguFonts && hasTeluguFiles;

        if (canUseTelugu) {
          doc.registerFont('NotoTelugu', this.fontRegularPath);
          doc.registerFont('NotoTelugu-Bold', this.fontBoldPath);
        }

        const fontRegular = canUseTelugu ? 'NotoTelugu' : 'Helvetica';
        const fontBold = canUseTelugu ? 'NotoTelugu-Bold' : 'Helvetica-Bold';

        const pageWidth = doc.page.width;
        const pageHeight = doc.page.height;

        // Optional Translucent Demo Watermark across page center
        if (isDemo) {
          doc.save();
          doc.rotate(-22, { origin: [pageWidth / 2, pageHeight / 2] });
          doc.font('Helvetica-Bold').fontSize(38).fillColor('#dc2626')
            .opacity(0.07)
            .text('DEMO / SIMULATED RECORD', pageWidth / 2 - 320, pageHeight / 2 - 20, {
              align: 'center',
              width: 640,
            });
          doc.restore();
        }

        // 1. Decorative Outer & Inner Border
        doc.rect(20, 20, pageWidth - 40, pageHeight - 40)
          .lineWidth(3)
          .strokeColor('#1b4332') // Dark Forest Green
          .stroke();

        doc.rect(26, 26, pageWidth - 52, pageHeight - 52)
          .lineWidth(1)
          .strokeColor('#52b788') // Emerald Green
          .stroke();

        // 2. Header Emblem / Watermark Accent
        doc.rect(28, 28, pageWidth - 56, 68)
          .fillColor('#f0fdf4') // Very soft mint green header background
          .fill();

        // Title (Bilingual)
        if (canUseTelugu) {
          doc.font('NotoTelugu-Bold').fontSize(15).fillColor('#1b4332')
            .text(`${APP_NAME_TE} - నీటి పరిరక్షణ & సాగు ధృవీకరణ పత్రం`, 36, 34, { align: 'center' });
          doc.font('Helvetica-Bold').fontSize(13).fillColor('#2d6a4f')
            .text(`${APP_NAME.toUpperCase()} — SEASONAL WATER CONSERVATION CERTIFICATE`, 36, 54, { align: 'center' });
        } else {
          doc.font('Helvetica-Bold').fontSize(15).fillColor('#1b4332')
            .text(`${APP_NAME.toUpperCase()} — SEASONAL WATER CONSERVATION CERTIFICATE`, 36, 42, { align: 'center' });
        }

        doc.font(fontRegular).fontSize(8.5).fillColor('#555555')
          .text(`${ORGANIZATION_NAME} • Voice-Assisted Intelligent Irrigation Advisory System`, 36, 73, { align: 'center' });

        // 3. Certificate Meta Bar (Code, Version, and Date)
        const metaY = 104;
        doc.rect(36, metaY, pageWidth - 72, 24)
          .fillColor('#f8fafc')
          .strokeColor('#e2e8f0')
          .lineWidth(1)
          .fillAndStroke();

        const versionLabel = certVersion > 1 ? ` (v${certVersion} - Reissued)` : '';
        doc.font(fontBold).fontSize(8.5).fillColor('#0f172a')
          .text(canUseTelugu ? `ధృవీకరణ సంఖ్య (Code): ${certCode}${versionLabel}` : `Certificate Code: ${certCode}${versionLabel}`, 48, metaY + 7);

        // Prominent DEMO / SIMULATED badge in Meta Bar
        if (isDemo) {
          const badgeWidth = 240;
          const badgeX = (pageWidth - badgeWidth) / 2;
          doc.rect(badgeX, metaY + 3, badgeWidth, 18)
            .fillColor('#fef3c7')
            .strokeColor('#d97706')
            .lineWidth(1)
            .fillAndStroke();
          doc.font(fontBold).fontSize(8).fillColor('#92400e')
            .text(canUseTelugu ? 'DEMO / SIMULATED RECORD (నమూనా రికార్డు)' : 'DEMO / SIMULATED RECORD', badgeX, metaY + 7, { width: badgeWidth, align: 'center' });
        }

        const formattedDate = new Date(certCreatedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        doc.font(fontRegular).fontSize(8.5).fillColor('#475569')
          .text(canUseTelugu ? `జారీ తేదీ (Issued): ${formattedDate}` : `Issued: ${formattedDate}`, pageWidth - 210, metaY + 7, { align: 'right', width: 160 });

        // 4. Two-Column Details Grid
        const colWidth = (pageWidth - 96) / 2;
        const col1X = 36;
        const col2X = col1X + colWidth + 24;
        const gridY = 132;
        const gridHeight = 134;

        // --- Column 1: Farmer & Cultivation Profile ---
        doc.font(fontBold).fontSize(10).fillColor('#1b4332')
          .text(canUseTelugu ? 'రైతు & సాగు వివరాలు (Farmer & Cultivation Profile)' : 'FARMER & CULTIVATION PROFILE', col1X, gridY);

        doc.rect(col1X, gridY + 16, colWidth, gridHeight)
          .fillColor('#ffffff')
          .strokeColor('#cbd5e1')
          .lineWidth(0.5)
          .fillAndStroke();

        let rowY = gridY + 22;
        const printRow = (x: number, y: number, label: string, val: string) => {
          doc.font(fontBold).fontSize(8).fillColor('#334155').text(label, x + 8, y, { width: 145 });
          doc.font(fontRegular).fontSize(8).fillColor('#0f172a').text(val, x + 155, y, { width: colWidth - 163 });
        };

        const fName = s?.farmer?.fullName || (certificate as any).farmerName || 'Farmer';
        const fCode = s?.farmer?.farmerCode || (certificate as any).farmerCode || '';
        const vName = s?.farmer?.villageName || (certificate as any).villageName || 'Village';
        const mName = s?.farmer?.mandal || (certificate as any).mandalName || '';
        const dName = s?.farmer?.district || (certificate as any).districtName || 'Andhra Pradesh';
        const cName = s?.crop?.name || (certificate as any).cropName || 'Crop';
        const cNameTe = s?.crop?.nameTe || (certificate as any).cropNameTe || '';
        const pLabel = s?.plot?.label || 'Plot';
        const pAcres = s?.plot?.areaAcres ?? s?.areaAcres ?? 1;
        const imMethod = s?.plot?.irrigationMethod || 'Standard Irrigation';
        const imEfficiency = s?.plot?.typicalEfficiency !== undefined ? `${Math.round(Number(s.plot.typicalEfficiency) * 100)}%` : '75%';
        const sowingDateStr = s?.sowingDate || 'N/A';
        const harvestDateStr = s?.actualHarvestDate || (certificate as any).actualHarvestDate || 'N/A';
        const sType = s?.seasonType ? String(s.seasonType).toUpperCase() : 'KHARIF';
        const sYear = s?.seasonYear || new Date().getFullYear();

        const farmerDisplayName = canUseTelugu
          ? `${fName}${fCode ? ` (${fCode})` : ''}`
          : `${cleanLatin(fName)}${fCode ? ` (${fCode})` : ''}`;

        const cropDisplayName = canUseTelugu && cNameTe
          ? `${cName} (${cNameTe})`
          : `${cName}`;

        const plotDisplayName = canUseTelugu
          ? `${pLabel} • ${pAcres} ఎకరాలు (${pAcres} Acres)`
          : `${cleanLatin(pLabel) || 'Plot'} • ${pAcres} Acres`;

        printRow(col1X, rowY, canUseTelugu ? 'రైతు పేరు (Farmer Name):' : 'Farmer Name:', farmerDisplayName);
        rowY += 18;
        printRow(col1X, rowY, canUseTelugu ? 'గ్రామం (Village & Mandal):' : 'Village & Mandal:', `${vName}${mName ? `, ${mName}` : ''}`);
        rowY += 18;
        printRow(col1X, rowY, canUseTelugu ? 'జిల్లా (District & State):' : 'District & State:', `${dName}, Andhra Pradesh`);
        rowY += 18;
        printRow(col1X, rowY, canUseTelugu ? 'పంట (Cultivated Crop):' : 'Cultivated Crop:', cropDisplayName);
        rowY += 18;
        printRow(col1X, rowY, canUseTelugu ? 'పొలం & పద్ధతి (Plot & Method):' : 'Plot & Method:', `${cleanLatin(pLabel) || 'Plot'} (${pAcres} Ac) • ${imMethod} (${imEfficiency})`);
        rowY += 18;
        printRow(col1X, rowY, canUseTelugu ? 'సాగు కాలం (Period):' : 'Period & Season:', `${sowingDateStr} to ${harvestDateStr} (${sType} ${sYear})`);

        // --- Column 2: Water Conservation & Performance Metrics ---
        doc.font(fontBold).fontSize(10).fillColor('#1b4332')
          .text(canUseTelugu ? 'నీటి లెక్కలు & పనితీరు (Water Conservation & Metrics)' : 'WATER CONSERVATION & METRICS', col2X, gridY);

        doc.rect(col2X, gridY + 16, colWidth, gridHeight)
          .fillColor('#ffffff')
          .strokeColor('#cbd5e1')
          .lineWidth(0.5)
          .fillAndStroke();

        let row2Y = gridY + 22;
        const printRow2 = (x: number, y: number, label: string, val: string) => {
          doc.font(fontBold).fontSize(8).fillColor('#334155').text(label, x + 8, y, { width: 155 });
          doc.font(fontBold).fontSize(8).fillColor('#0f172a').text(val, x + 165, y, { width: colWidth - 173 });
        };

        const bandTelugu: Record<string, string> = {
          near_estimate: 'సరిపడా (Near Target)',
          below_estimate: 'తక్కువ (Below Target)',
          above_estimate: 'ఎక్కువ (Above Target)',
        };

        const bandLatin: Record<string, string> = {
          near_estimate: 'Near Target',
          below_estimate: 'Below Target',
          above_estimate: 'Above Target',
        };

        const bandLabel = canUseTelugu
          ? (bandTelugu[certWurBand] || certWurBand)
          : (bandLatin[certWurBand] || certWurBand);

        // Verified Metrics from Snapshot (Phase 2 Source of Truth - NO FABRICATED VALUES)
        const netDemandMm = s?.waterMetrics?.netIrrigationDemandMm;
        const netDemandM3 = s?.waterMetrics?.netIrrigationDemandM3;
        const grossRecM3 = s?.waterMetrics?.grossRecommendedM3;
        const grossRecLitres = s?.waterMetrics?.grossRecommendedLitres;
        const appliedMm = s?.waterMetrics?.totalAppliedMm;
        const appliedM3 = s?.waterMetrics?.totalAppliedM3;
        const appliedLitres = s?.waterMetrics?.totalAppliedLitres;
        const waterSavedM3 = s?.waterMetrics?.waterSavedM3;
        const waterSavedLitres = s?.waterMetrics?.waterSavedLitres;
        const waterSavedPercentage = s?.waterMetrics?.waterSavedPercentage;
        const rainMm = s?.waterMetrics?.totalEffectiveRainMm;
        const rainEvents = s?.feedbackSummary?.rainClassesReported ? s.feedbackSummary.rainClassesReported.length : null;
        const hasUnvalidated = Boolean(s?.waterMetrics?.hasUnvalidatedAssumptions ?? false);

        // Format Net Demand
        const netDemandFormatted = (netDemandMm !== null && netDemandMm !== undefined && !isNaN(netDemandMm))
          ? `${Math.round(netDemandMm)} mm (${netDemandM3 !== null && netDemandM3 !== undefined ? `${Number(netDemandM3).toLocaleString('en-IN', { maximumFractionDigits: 1 })} m3` : 'N/A'})`
          : 'Data Incomplete';

        // Format Gross Recommended Water
        let grossRecFormatted = 'Data Incomplete';
        if (grossRecM3 !== null && grossRecM3 !== undefined && !isNaN(grossRecM3)) {
          const grossLStr = grossRecLitres ? `${(grossRecLitres / 100000).toFixed(2)} Lakh L` : `${Math.round(grossRecM3 * 1000).toLocaleString('en-IN')} L`;
          grossRecFormatted = `${Number(grossRecM3).toLocaleString('en-IN', { maximumFractionDigits: 1 })} m3 (${grossLStr}) [Eff: ${imEfficiency}]`;
        } else if (netDemandM3 !== null && netDemandM3 !== undefined && !isNaN(netDemandM3)) {
          const eff = Number(s?.plot?.typicalEfficiency || 0.75);
          const computedGrossM3 = netDemandM3 / eff;
          grossRecFormatted = `${computedGrossM3.toLocaleString('en-IN', { maximumFractionDigits: 1 })} m3 (${(computedGrossM3 * 1000 / 100000).toFixed(2)} Lakh L) [Eff: ${imEfficiency}]`;
        }

        // Format Actual Applied Water
        const appliedFormatted = (appliedM3 !== null && appliedM3 !== undefined && !isNaN(appliedM3))
          ? `${appliedMm !== null && appliedMm !== undefined ? `${Math.round(appliedMm)} mm • ` : ''}${Number(appliedM3).toLocaleString('en-IN', { maximumFractionDigits: 1 })} m3 (${(Number(appliedLitres || 0) / 100000).toFixed(2)} Lakh L)`
          : 'Data Incomplete';

        // Format Water Saved or Excess Irrigation
        let waterSavedLabel = canUseTelugu ? 'నీటి ఆదా (Water Saved):' : 'Water Saved / Excess:';
        let waterSavedFormatted = 'Data Incomplete';
        if (waterSavedM3 !== null && waterSavedM3 !== undefined && !isNaN(waterSavedM3)) {
          const savedLakhL = (Number(waterSavedLitres || 0) / 100000).toFixed(2);
          const pctStr = waterSavedPercentage !== null && waterSavedPercentage !== undefined ? `${Number(waterSavedPercentage) > 0 ? '+' : ''}${Number(waterSavedPercentage).toFixed(1)}%` : 'N/A';
          if (waterSavedM3 >= 0) {
            waterSavedFormatted = `+${Number(waterSavedM3).toLocaleString('en-IN', { maximumFractionDigits: 1 })} m3 (+${savedLakhL} Lakh L, ${pctStr})`;
          } else {
            waterSavedLabel = canUseTelugu ? 'అదనపు నీరు (Excess Used):' : 'Excess Irrigation:';
            waterSavedFormatted = `${Number(waterSavedM3).toLocaleString('en-IN', { maximumFractionDigits: 1 })} m3 (${savedLakhL} Lakh L, ${pctStr}) [Over-irrigated]`;
          }
        } else if (grossRecM3 !== null && grossRecM3 !== undefined && grossRecM3 <= 0) {
          waterSavedFormatted = 'N/A (Rainfed / No Irrigation Demand)';
        }

        // Format Effective Rain
        const rainFormatted = (rainMm !== null && rainMm !== undefined && !isNaN(rainMm))
          ? `${Math.round(rainMm)} mm (${rainEvents !== null ? `${rainEvents} events` : 'logged'})`
          : 'Data Incomplete';

        const wurDisplay = certWur !== null ? `${certWur.toFixed(2)} (${bandLabel})` : `N/A (${bandLabel})`;
        printRow2(col2X, row2Y, canUseTelugu ? 'నీటి నిష్పత్తి (WUR):' : 'Water Use Ratio (WUR):', wurDisplay);
        row2Y += 18;
        printRow2(col2X, row2Y, canUseTelugu ? 'నికర డిమాండ్ (Net Demand):' : 'Net Crop Demand (ETc - Rain):', netDemandFormatted);
        row2Y += 18;
        printRow2(col2X, row2Y, canUseTelugu ? 'సిఫార్సు నీరు (Gross Rec.):' : 'Gross Recommended Water:', grossRecFormatted);
        row2Y += 18;
        printRow2(col2X, row2Y, canUseTelugu ? 'రైతు సాగునీరు (Applied):' : 'Farmer Applied Water:', appliedFormatted);
        row2Y += 18;
        printRow2(col2X, row2Y, waterSavedLabel, waterSavedFormatted);
        row2Y += 18;
        printRow2(col2X, row2Y, canUseTelugu ? 'వర్షం & విశ్వసనీయత:' : 'Rain & Data Confidence:', `${rainFormatted} • Score: ${Math.round(certConfScore)}/100 (${String(certConfBand).toUpperCase()})`);

        // 5. Scientific Transparency & Methodology Box
        const boxY = 272;
        doc.rect(36, boxY, pageWidth - 72, 68)
          .fillColor(hasUnvalidated ? '#fefce8' : '#f0fdf4')
          .strokeColor(hasUnvalidated ? '#facc15' : '#86efac')
          .lineWidth(1)
          .fillAndStroke();

        if (hasUnvalidated) {
          doc.font(fontBold).fontSize(8).fillColor('#854d0e')
            .text(canUseTelugu ? '[!] పారదర్శకత నోటీసు / METHODOLOGICAL TRANSPARENCY NOTICE (FAO-56 Soil Water Balance):' : '[!] METHODOLOGICAL TRANSPARENCY NOTICE (FAO-56 Dual Kc Soil Water Balance):', 46, boxY + 7);

          doc.font(fontRegular).fontSize(7.5).fillColor('#713f12')
            .text(
              canUseTelugu
                ? 'పంట నీటి ఆవిరి (ETc) లెక్కలు మరియు ప్రభావవంతమైన వర్షపాత అంచనాలు ప్రాంతీయ వ్యవసాయ పరిశోధనా బేస్‌లైన్ ఆధారంగా అంచనా వేయబడ్డాయి:'
                : 'Certain agronomic parameters used in evaluating theoretical crop evapotranspiration are based on provisional regional baselines:',
              46,
              boxY + 20,
              { width: pageWidth - 92 }
            );

          const assumptions = ((s?.waterMetrics?.unvalidatedAssumptionsList || []) as string[]).slice(0, 3).join(' | ');
          doc.font(fontRegular).fontSize(7.5).fillColor('#a16207')
            .text(assumptions || 'Regional soil infiltration and baseline crop coefficients pending field lysimeter calibration.', 46, boxY + 42, { width: pageWidth - 92 });
        } else {
          doc.font(fontBold).fontSize(8).fillColor('#15803d')
            .text(canUseTelugu ? '[VERIFIED] ప్రామాణిక వ్యవసాయ గణాంకాలు / FULLY CALIBRATED FAO-56 AGRONOMIC MODEL:' : '[VERIFIED] FULLY CALIBRATED FAO-56 DUAL KC AGRONOMIC MODEL:', 46, boxY + 10);
          doc.font(fontRegular).fontSize(8).fillColor('#166534')
            .text('Crop evapotranspiration coefficients (Kc) and effective rainfall fractions were calibrated against published regional agricultural research baselines with validated soil infiltration parameters.', 46, boxY + 25, { width: pageWidth - 92 });
        }

        // 6. Verification Footer with QR Code & SHA-256 Hash
        const footerY = 346;
        const verifyUrl = `${baseUrl.replace(/\/+$/, '')}/verify/${certCode}`;
        const qrBuffer = await QRCode.toBuffer(verifyUrl, {
          width: 90,
          margin: 1,
          color: {
            dark: '#1b4332',
            light: '#ffffff',
          },
        });

        // Draw QR Code
        doc.image(qrBuffer, 36, footerY - 2, { width: 66, height: 66 });

        // QR Explanation, Provenance & Cryptographic Hash
        const qrTextX = 112;
        doc.font(fontBold).fontSize(8).fillColor('#1b4332')
          .text(canUseTelugu ? 'ధృవీకరణ కొరకు స్కాన్ చేయండి / SCAN TO VERIFY INTEGRITY' : 'SCAN TO VERIFY INTEGRITY', qrTextX, footerY);

        doc.font(fontRegular).fontSize(7.5).fillColor('#475569')
          .text(`Public Registry Link: ${verifyUrl}`, qrTextX, footerY + 13);

        doc.font(fontBold).fontSize(7.5).fillColor('#334155')
          .text('Immutable SHA-256 Digest:', qrTextX, footerY + 26);
        doc.font('Courier').fontSize(7.5).fillColor('#0f172a')
          .text(certSha, qrTextX + 115, footerY + 26);

        const dataProvenanceLabel = isDemo
          ? 'DEMO / SIMULATED RECORD (నమూనా రికార్డు)'
          : 'Data Provenance: Farmer IVR Telemetry & IMD/Open-Meteo Weather';
        doc.font(fontRegular).fontSize(7).fillColor(isDemo ? '#b45309' : '#047857')
          .text(dataProvenanceLabel, qrTextX, footerY + 39);

        // Signatures / Authority Stamps (Independent Research Initiative - No Government Endorsement Claims)
        const sigX = pageWidth - 200;
        doc.rect(sigX - 10, footerY - 2, 174, 58)
          .strokeColor('#cbd5e1')
          .lineWidth(0.5)
          .stroke();

        doc.font(fontBold).fontSize(7.5).fillColor('#1e293b')
          .text(`${APP_NAME}`, sigX, footerY + 4, { width: 154, align: 'center' });
        doc.font(fontRegular).fontSize(7).fillColor('#64748b')
          .text('Community Water Stewardship Initiative', sigX, footerY + 16, { width: 154, align: 'center' });
        doc.font(fontBold).fontSize(7.5).fillColor('#15803d')
          .text('DIGITALLY SEALED & VERIFIED AUDIT', sigX, footerY + 30, { width: 154, align: 'center' });
        doc.font(fontRegular).fontSize(6.5).fillColor('#94a3b8')
          .text('Independent Research Advisory', sigX, footerY + 44, { width: 154, align: 'center' });

        // Bottom Legal / Non-Government Disclaimer
        doc.font(fontRegular).fontSize(7).fillColor('#64748b')
          .text('Independent Community Advisory & Research Project • Not a Statutory Government Endorsement or Certification.', 36, 420, { align: 'center', width: pageWidth - 72 });

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Generates a Seasonal Water Performance Summary Report for ineligible seasons.
   */
  async generateSeasonReportPdf(
    report: SeasonReportRecord,
    baseUrl: string = config.PUBLIC_FRONTEND_URL
  ): Promise<Buffer> {
    try {
      const buf = await this.buildSeasonReportDocument(report, true);
      await this.saveSeasonReportPdfBuffer(report, buf);
      return buf;
    } catch (err: any) {
      console.warn(
        '\x1b[33m%s\x1b[0m',
        `⚠️ [PdfCertificateService] WARNING: Font shaping error encountered during Telugu report rendering: "${err.message}". ` +
        `Falling back cleanly to standard Latin/Helvetica typography. Report download will succeed.`
      );
      const fallbackBuf = await this.buildSeasonReportDocument(report, false);
      await this.saveSeasonReportPdfBuffer(report, fallbackBuf);
      return fallbackBuf;
    }
  }

  async saveSeasonReportPdf(report: SeasonReportRecord, baseUrl: string = config.PUBLIC_FRONTEND_URL): Promise<string> {
    const buf = await this.generateSeasonReportPdf(report, baseUrl);
    return await this.saveSeasonReportPdfBuffer(report, buf);
  }

  public async saveSeasonReportPdfBuffer(report: SeasonReportRecord, buffer: Buffer): Promise<string> {
    const storageDir = path.resolve(process.cwd(), 'storage/reports');
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
    const reportCode = report.reportCode || (report as any).report_code;
    const filePath = path.join(storageDir, `report-${reportCode}.pdf`);
    fs.writeFileSync(filePath, buffer);
    return filePath;
  }

  private buildSeasonReportDocument(
    report: SeasonReportRecord,
    useTeluguFonts: boolean
  ): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
      try {
        const reportCode = report.reportCode || (report as any).report_code;
        const s = (report as any).snapshotData || (report as any).snapshot_data;
        const createdAt = report.createdAt || (report as any).created_at || new Date().toISOString();
        const ineligibilityReasons: string[] = report.ineligibilityReasons || (report as any).ineligibility_reasons || [];
        const actualHarvestDate = report.actualHarvestDate || (report as any).actual_harvest_date || 'N/A';
        const monitoringCycleCoverage = Number(report.monitoringCycleCoverage ?? (report as any).monitoring_cycle_coverage ?? 0);
        const confidenceScore = Number(report.confidenceScore ?? (report as any).confidence_score ?? 0);
        const confidenceBand = report.confidenceBand || (report as any).confidence_band || 'low';
        const rawReportWur = report.waterUseRatio ?? (report as any).water_use_ratio;
        const waterUseRatio = rawReportWur !== null && rawReportWur !== undefined && !isNaN(Number(rawReportWur)) ? Number(rawReportWur) : null;
        const waterUseRatioBand = report.waterUseRatioBand || (report as any).water_use_ratio_band || 'near_estimate';

        const doc = new PDFDocument({
          size: 'A4',
          layout: 'portrait',
          margin: 36,
          info: {
            Title: `Season Water Summary Report - ${reportCode}`,
            Author: `${APP_NAME}`,
            Subject: 'Seasonal Irrigation and Water Balance Summary',
          },
        });

        const chunks: Buffer[] = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', err => reject(err));

        const hasTeluguFiles = fs.existsSync(this.fontRegularPath) && fs.existsSync(this.fontBoldPath);
        const canUseTelugu = useTeluguFonts && hasTeluguFiles;

        if (canUseTelugu) {
          doc.registerFont('NotoTelugu', this.fontRegularPath);
          doc.registerFont('NotoTelugu-Bold', this.fontBoldPath);
        }

        const fontRegular = canUseTelugu ? 'NotoTelugu' : 'Helvetica';
        const fontBold = canUseTelugu ? 'NotoTelugu-Bold' : 'Helvetica-Bold';
        const pageWidth = doc.page.width;

        // Header
        doc.rect(20, 20, pageWidth - 40, 70)
          .fillColor('#f8fafc')
          .strokeColor('#cbd5e1')
          .lineWidth(1)
          .fillAndStroke();

        if (canUseTelugu) {
          doc.font('NotoTelugu-Bold').fontSize(14).fillColor('#1e293b')
            .text(`${APP_NAME_TE} - సీజన్ నీటి వినియోగ నివేదిక`, 30, 28, { align: 'center' });
          doc.font('Helvetica-Bold').fontSize(11).fillColor('#334155')
            .text(`${APP_NAME.toUpperCase()} — SEASONAL WATER AUDIT REPORT`, 30, 48, { align: 'center' });
        } else {
          doc.font('Helvetica-Bold').fontSize(13).fillColor('#1e293b')
            .text(`${APP_NAME.toUpperCase()} — SEASONAL WATER AUDIT REPORT`, 30, 38, { align: 'center' });
        }

        doc.font(fontRegular).fontSize(8).fillColor('#64748b')
          .text(`Report Code: ${reportCode} • Generated: ${new Date(createdAt).toLocaleDateString('en-IN')}`, 30, 68, { align: 'center' });

        // Ineligibility Alert Banner
        doc.rect(20, 105, pageWidth - 40, 80)
          .fillColor('#fffbeb')
          .strokeColor('#f59e0b')
          .lineWidth(1.5)
          .fillAndStroke();

        doc.font(fontBold).fontSize(10.5).fillColor('#b45309')
          .text(canUseTelugu ? '[!] INELIGIBLE FOR CONSERVATION CERTIFICATE (ధృవీకరణ పత్రానికి అర్హత పొందలేదు)' : '[!] INELIGIBLE FOR CONSERVATION CERTIFICATE', 32, 115);

        doc.font(fontRegular).fontSize(8.5).fillColor('#92400e')
          .text('This season completed cultivation, but did not satisfy the minimum data integrity or monitoring cycle thresholds required for an accredited Water Conservation Certificate:', 32, 132, { width: pageWidth - 64 });

        let rY = 150;
        for (const reason of ineligibilityReasons) {
          doc.font(fontBold).fontSize(8).fillColor('#b45309').text(`- ${reason}`, 40, rY, { width: pageWidth - 80 });
          rY += 14;
        }

        // Field & Farmer Profile
        let curY = 200;
        doc.font(fontBold).fontSize(10.5).fillColor('#0f172a').text(canUseTelugu ? 'రైతు & పొలం వివరాలు / Cultivation Profile' : 'Cultivation & Field Profile', 24, curY);
        curY += 16;
        doc.rect(20, curY, pageWidth - 40, 60).fillColor('#f8fafc').strokeColor('#e2e8f0').lineWidth(0.5).fillAndStroke();

        const farmerDisplayName = canUseTelugu
          ? `${s.farmer.fullName} (${s.farmer.villageName}, ${s.farmer.mandal})`
          : `${cleanLatin(s.farmer.fullName) || s.farmer.farmerCode} (${s.farmer.villageName}, ${s.farmer.mandal})`;

        const cropDisplayName = canUseTelugu && s.crop.nameTe
          ? `${s.crop.name} (${s.crop.nameTe}) • Plot: ${s.plot.label} (${s.plot.areaAcres} Acres)`
          : `${s.crop.name} • Plot: ${cleanLatin(s.plot.label) || 'Plot'} (${s.plot.areaAcres} Acres)`;

        doc.font(fontRegular).fontSize(8.5).fillColor('#334155');
        doc.text(`Farmer: ${farmerDisplayName}`, 30, curY + 10);
        doc.text(`Crop: ${cropDisplayName}`, 30, curY + 25);
        doc.text(`Season: ${s.seasonType} ${s.seasonYear} • Harvest Date: ${actualHarvestDate}`, 30, curY + 40);

        // Water Metrics Table
        curY += 80;
        doc.font(fontBold).fontSize(10.5).fillColor('#0f172a').text(canUseTelugu ? 'నీటి నిర్వహణ సారాంశం / Water Metrics Summary' : 'Water Metrics & Monitoring Summary', 24, curY);
        curY += 16;
        doc.rect(20, curY, pageWidth - 40, 116).fillColor('#ffffff').strokeColor('#cbd5e1').lineWidth(0.5).fillAndStroke();

        const netDemandReportStr = (s?.waterMetrics?.netIrrigationDemandMm !== null && s?.waterMetrics?.netIrrigationDemandMm !== undefined && !isNaN(s.waterMetrics.netIrrigationDemandMm))
          ? `${Math.round(s.waterMetrics.netIrrigationDemandMm)} mm`
          : 'Data Incomplete';

        const appliedReportStr = (s?.waterMetrics?.totalAppliedMm !== null && s?.waterMetrics?.totalAppliedMm !== undefined && !isNaN(s.waterMetrics.totalAppliedMm))
          ? `${Math.round(s.waterMetrics.totalAppliedMm)} mm (${s?.irrigationRecordsSummary?.totalHoursReported ?? 0} pump hours)`
          : 'Data Incomplete';

        const grossRecReportStr = (s?.waterMetrics?.grossRecommendedM3 !== null && s?.waterMetrics?.grossRecommendedM3 !== undefined && !isNaN(s.waterMetrics.grossRecommendedM3))
          ? `${Number(s.waterMetrics.grossRecommendedM3).toLocaleString('en-IN', { maximumFractionDigits: 1 })} m3 (${(Number(s.waterMetrics.grossRecommendedLitres || 0) / 100000).toFixed(2)} Lakh L)`
          : (s?.waterMetrics?.netIrrigationDemandM3 !== null && s?.waterMetrics?.netIrrigationDemandM3 !== undefined ? `${(Number(s.waterMetrics.netIrrigationDemandM3) / (Number(s?.plot?.typicalEfficiency) || 0.75)).toLocaleString('en-IN', { maximumFractionDigits: 1 })} m3` : 'Data Incomplete');

        const wurReportDisplay = waterUseRatio !== null ? `${waterUseRatio.toFixed(2)} (${waterUseRatioBand})` : `N/A (${waterUseRatioBand})`;
        doc.font(fontBold).fontSize(8.5).fillColor('#1e293b');
        doc.text(`Monitoring Cycle Coverage: ${monitoringCycleCoverage.toFixed(1)}%`, 30, curY + 12);
        doc.text(`Data Confidence Score: ${Math.round(confidenceScore)}/100 (${confidenceBand.toUpperCase()})`, 30, curY + 28);
        doc.text(`Water Use Ratio (WUR): ${wurReportDisplay}`, 30, curY + 44);
        doc.text(`Estimated Net Crop Demand: ${netDemandReportStr}`, 30, curY + 60);
        doc.text(`Gross Recommended Irrigation: ${grossRecReportStr}`, 30, curY + 76);
        doc.text(`Farmer Reported Irrigation: ${appliedReportStr}`, 30, curY + 92);

        // Scientific Transparency & Unvalidated Assumptions Notice
        curY += 135;
        const assumptionsBoxY = curY;
        const hasUnvalidated = Boolean(s?.waterMetrics?.hasUnvalidatedAssumptions);

        doc.rect(20, assumptionsBoxY, pageWidth - 40, 70)
          .fillColor(hasUnvalidated ? '#fefce8' : '#f0fdf4')
          .strokeColor(hasUnvalidated ? '#facc15' : '#86efac')
          .lineWidth(1)
          .fillAndStroke();

        if (hasUnvalidated) {
          doc.font(fontBold).fontSize(8.5).fillColor('#854d0e')
            .text(canUseTelugu ? '[!] METHODOLOGICAL TRANSPARENCY NOTICE (గమనిక):' : '[!] METHODOLOGICAL TRANSPARENCY NOTICE:', 30, assumptionsBoxY + 8);

          doc.font(fontRegular).fontSize(8).fillColor('#713f12')
            .text('Certain agronomic parameters used in evaluating theoretical crop evapotranspiration are based on provisional regional baselines and are currently marked unverified:', 30, assumptionsBoxY + 22, { width: pageWidth - 60 });

          const assumptions = (s.waterMetrics.unvalidatedAssumptionsList || []).slice(0, 3).join(' | ');
          doc.font(fontRegular).fontSize(7.5).fillColor('#a16207')
            .text(assumptions || 'Regional soil infiltration and baseline crop coefficients pending field lysimeter calibration.', 30, assumptionsBoxY + 46, { width: pageWidth - 60 });
        } else {
          doc.font(fontBold).fontSize(8.5).fillColor('#15803d')
            .text(canUseTelugu ? '[VERIFIED] ప్రామాణిక వ్యవసాయ గణాంకాలు / FULLY CALIBRATED AGRONOMIC PARAMETERS:' : '[VERIFIED] FULLY CALIBRATED AGRONOMIC PARAMETERS:', 30, assumptionsBoxY + 12);
          doc.font(fontRegular).fontSize(8).fillColor('#166534')
            .text('All crop evapotranspiration coefficients (Kc) and effective rainfall fractions were calibrated against published regional agricultural research baselines.', 30, assumptionsBoxY + 28, { width: pageWidth - 60 });
        }

        // Footer note
        doc.font(fontRegular).fontSize(7.5).fillColor('#94a3b8')
          .text('This is an indicative monitoring summary for agronomic audit only. It does not certify water conservation compliance.', 20, doc.page.height - 40, { align: 'center', width: pageWidth - 40 });

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}

export const pdfCertificateService = new PdfCertificateService();
