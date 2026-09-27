import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { config } from '../../config/index.js';
import { CertificateRecord, SeasonReportRecord } from './types.js';

export class PdfCertificateService {
  private fontRegularPath: string;
  private fontBoldPath: string;

  constructor() {
    this.fontRegularPath = path.resolve(process.cwd(), 'assets/fonts/NotoSansTelugu-Regular.ttf');
    this.fontBoldPath = path.resolve(process.cwd(), 'assets/fonts/NotoSansTelugu-Bold.ttf');
  }

  /**
   * Generates a high-resolution, bilingual PDF conservation certificate buffer.
   * Uses PUBLIC_FRONTEND_URL for QR code verification linking.
   */
  async generateCertificatePdf(
    certificate: CertificateRecord,
    baseUrl: string = config.PUBLIC_FRONTEND_URL
  ): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          layout: 'landscape',
          margin: 36, // 0.5 inch margins
          info: {
            Title: `Conservation Certificate - ${certificate.certificateCode}`,
            Author: 'Jalamitra Voice-Driven Irrigation System (CSP)',
            Subject: 'Seasonal Water Conservation Certificate',
            Keywords: 'irrigation, water conservation, andhra pradesh, telugu, fao-56',
          },
        });

        const chunks: Buffer[] = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', err => reject(err));

        // Register Telugu fonts if available, otherwise fallback to Helvetica
        const hasTeluguFonts = fs.existsSync(this.fontRegularPath) && fs.existsSync(this.fontBoldPath);
        if (hasTeluguFonts) {
          doc.registerFont('Telugu-Regular', this.fontRegularPath);
          doc.registerFont('Telugu-Bold', this.fontBoldPath);
        }

        const fontRegular = hasTeluguFonts ? 'Telugu-Regular' : 'Helvetica';
        const fontBold = hasTeluguFonts ? 'Telugu-Bold' : 'Helvetica-Bold';

        const s = certificate.snapshotData;
        const pageWidth = doc.page.width;
        const pageHeight = doc.page.height;

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
        doc.font(fontBold).fontSize(16).fillColor('#1b4332')
          .text('జలమిత్ర - నీటి పరిరక్షణ & సాగు ధృవీకరణ పత్రం', 36, 36, { align: 'center' });

        doc.font(fontBold).fontSize(13).fillColor('#2d6a4f')
          .text('JALAMITRA — SEASONAL WATER CONSERVATION CERTIFICATE', 36, 56, { align: 'center' });

        doc.font(fontRegular).fontSize(9).fillColor('#555555')
          .text('Community Service Project (CSP) • Intelligent Voice-Assisted Irrigation Management System', 36, 74, { align: 'center' });

        // 3. Certificate Meta Bar (Code, Version, and Date)
        const metaY = 106;
        doc.rect(36, metaY, pageWidth - 72, 24)
          .fillColor('#f8fafc')
          .strokeColor('#e2e8f0')
          .lineWidth(1)
          .fillAndStroke();

        const versionLabel = certificate.version > 1 ? ` (v${certificate.version} - Reissued)` : '';
        doc.font(fontBold).fontSize(9).fillColor('#0f172a')
          .text(`Certificate Code: ${certificate.certificateCode}${versionLabel}`, 48, metaY + 7);

        doc.font(fontRegular).fontSize(9).fillColor('#475569')
          .text(`Issued On: ${new Date(certificate.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`, pageWidth - 200, metaY + 7, { align: 'right', width: 150 });

        // 4. Two-Column Details Grid
        const colWidth = (pageWidth - 96) / 2;
        const col1X = 36;
        const col2X = col1X + colWidth + 24;
        const gridY = 140;

        // --- Column 1: Farmer & Farm Profile ---
        doc.font(fontBold).fontSize(11).fillColor('#1b4332')
          .text('FARMER & FIELD IDENTIFICATION (రైతు & పొలం వివరాలు)', col1X, gridY);

        doc.rect(col1X, gridY + 16, colWidth, 110)
          .fillColor('#ffffff')
          .strokeColor('#cbd5e1')
          .lineWidth(0.5)
          .fillAndStroke();

        let rowY = gridY + 24;
        const printRow = (x: number, y: number, label: string, val: string) => {
          doc.font(fontBold).fontSize(9).fillColor('#334155').text(label, x + 8, y, { width: 110 });
          doc.font(fontRegular).fontSize(9).fillColor('#0f172a').text(val, x + 120, y, { width: colWidth - 128 });
        };

        printRow(col1X, rowY, 'Farmer Name:', `${s.farmer.fullName} (${s.farmer.farmerCode})`);
        rowY += 18;
        printRow(col1X, rowY, 'Village & Mandal:', `${s.farmer.villageName}, ${s.farmer.mandal}`);
        rowY += 18;
        printRow(col1X, rowY, 'District & State:', `${s.farmer.district}, Andhra Pradesh`);
        rowY += 18;
        printRow(col1X, rowY, 'Cultivated Crop:', `${s.crop.name} (${s.crop.nameTe})`);
        rowY += 18;
        printRow(col1X, rowY, 'Plot & Area:', `${s.plot.label} • ${s.plot.areaAcres} Acres`);

        // --- Column 2: Water Conservation & Performance Metrics ---
        doc.font(fontBold).fontSize(11).fillColor('#1b4332')
          .text('WATER USE & PERFORMANCE (నీటి లెక్కలు & పనితీరు)', col2X, gridY);

        doc.rect(col2X, gridY + 16, colWidth, 110)
          .fillColor('#ffffff')
          .strokeColor('#cbd5e1')
          .lineWidth(0.5)
          .fillAndStroke();

        let row2Y = gridY + 24;
        const printRow2 = (x: number, y: number, label: string, val: string) => {
          doc.font(fontBold).fontSize(9).fillColor('#334155').text(label, x + 8, y, { width: 130 });
          doc.font(fontBold).fontSize(9).fillColor('#0f172a').text(val, x + 140, y, { width: colWidth - 148 });
        };

        const bandTelugu: Record<string, string> = {
          near_estimate: 'Near Target (సరిపడా)',
          below_estimate: 'Below Target (తక్కువ)',
          above_estimate: 'Above Target (ఎక్కువ)',
        };

        printRow2(col2X, row2Y, 'Water Use Ratio (WUR):', `${certificate.waterUseRatio.toFixed(2)} (${bandTelugu[certificate.waterUseRatioBand] || certificate.waterUseRatioBand})`);
        row2Y += 18;
        printRow2(col2X, row2Y, 'Estimated Net Demand:', `${Math.round(s.waterMetrics.netIrrigationDemandMm)} mm (${(s.waterMetrics.netIrrigationDemandM3 / 1000).toFixed(1)}k m³)`);
        row2Y += 18;
        printRow2(col2X, row2Y, 'Farmer-Reported Water:', `${Math.round(s.waterMetrics.totalAppliedMm)} mm (${(s.waterMetrics.totalAppliedLitres / 100000).toFixed(1)} Lakh L)`);
        row2Y += 18;
        printRow2(col2X, row2Y, 'Effective Rainfall:', `${Math.round(s.waterMetrics.totalEffectiveRainMm)} mm (${s.feedbackSummary.rainClassesReported.length} events reported)`);
        row2Y += 18;
        printRow2(col2X, row2Y, 'Data Confidence Score:', `${Math.round(certificate.confidenceScore)}/100 (${certificate.confidenceBand.toUpperCase()})`);

        // 5. Scientific Transparency & Unvalidated Assumptions Box
        const boxY = 270;
        doc.rect(36, boxY, pageWidth - 72, 76)
          .fillColor(s.waterMetrics.hasUnvalidatedAssumptions ? '#fefce8' : '#f0fdf4')
          .strokeColor(s.waterMetrics.hasUnvalidatedAssumptions ? '#facc15' : '#86efac')
          .lineWidth(1)
          .fillAndStroke();

        if (s.waterMetrics.hasUnvalidatedAssumptions) {
          doc.font(fontBold).fontSize(9).fillColor('#854d0e')
            .text('⚠️ METHODOLOGICAL TRANSPARENCY NOTICE (గమనిక):', 46, boxY + 8);

          doc.font(fontRegular).fontSize(8).fillColor('#713f12')
            .text('Certain agronomic parameters used in evaluating theoretical crop evapotranspiration and effective rainfall are based on provisional regional baselines and are currently marked unverified:', 46, boxY + 22, { width: pageWidth - 92 });

          const assumptions = s.waterMetrics.unvalidatedAssumptionsList.slice(0, 3).join(' • ');
          doc.font('Helvetica-Oblique').fontSize(7.5).fillColor('#a16207')
            .text(assumptions || 'Regional soil infiltration and baseline crop coefficients pending field lysimeter calibration.', 46, boxY + 48, { width: pageWidth - 92 });
        } else {
          doc.font(fontBold).fontSize(9).fillColor('#15803d')
            .text('✅ FULLY CALIBRATED AGRONOMIC PARAMETERS:', 46, boxY + 12);
          doc.font(fontRegular).fontSize(8.5).fillColor('#166534')
            .text('All crop evapotranspiration coefficients (Kc) and effective rainfall fractions were calibrated against published regional agricultural research baselines.', 46, boxY + 28, { width: pageWidth - 92 });
        }

        // 6. Verification Footer with QR Code & SHA-256 Hash
        // Fix for Directive 2: baseUrl defaults to config.PUBLIC_FRONTEND_URL
        const footerY = 362;
        const verifyUrl = `${baseUrl.replace(/\/+$/, '')}/verify/${certificate.certificateCode}`;
        const qrBuffer = await QRCode.toBuffer(verifyUrl, {
          width: 90,
          margin: 1,
          color: {
            dark: '#1b4332',
            light: '#ffffff',
          },
        });

        // Draw QR Code
        doc.image(qrBuffer, 36, footerY - 5, { width: 68, height: 68 });

        // QR Explanation & Cryptographic Hash
        const qrTextX = 114;
        doc.font(fontBold).fontSize(8.5).fillColor('#1b4332')
          .text('SCAN TO VERIFY AUTHENTICITY & INTEGRITY (ధృవీకరణ కొరకు స్కాన్ చేయండి)', qrTextX, footerY);

        doc.font(fontRegular).fontSize(8).fillColor('#475569')
          .text(`Public Verification Link: ${verifyUrl}`, qrTextX, footerY + 14);

        doc.font(fontBold).fontSize(8).fillColor('#334155')
          .text('Cryptographic SHA-256 Immutable Snapshot Hash:', qrTextX, footerY + 28);

        doc.font('Courier').fontSize(7.5).fillColor('#0f172a')
          .text(certificate.sha256Hash, qrTextX, footerY + 40, { width: pageWidth - qrTextX - 40 });

        doc.font(fontRegular).fontSize(7).fillColor('#64748b')
          .text('This document was cryptographically sealed upon season completion. Any alteration of physical values or records invalidates this hash.', qrTextX, footerY + 54);

        // Finalize PDF Document
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
    report: SeasonReportRecord
  ): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          layout: 'portrait',
          margin: 36,
          info: {
            Title: `Season Water Summary Report - ${report.reportCode}`,
            Author: 'Jalamitra Voice-Driven Irrigation System (CSP)',
            Subject: 'Seasonal Irrigation and Water Balance Summary',
          },
        });

        const chunks: Buffer[] = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', err => reject(err));

        const hasTeluguFonts = fs.existsSync(this.fontRegularPath) && fs.existsSync(this.fontBoldPath);
        if (hasTeluguFonts) {
          doc.registerFont('Telugu-Regular', this.fontRegularPath);
          doc.registerFont('Telugu-Bold', this.fontBoldPath);
        }

        const fontRegular = hasTeluguFonts ? 'Telugu-Regular' : 'Helvetica';
        const fontBold = hasTeluguFonts ? 'Telugu-Bold' : 'Helvetica-Bold';
        const pageWidth = doc.page.width;
        const s = report.snapshotData;

        // Header
        doc.rect(20, 20, pageWidth - 40, 70)
          .fillColor('#f8fafc')
          .strokeColor('#cbd5e1')
          .lineWidth(1)
          .fillAndStroke();

        doc.font(fontBold).fontSize(14).fillColor('#1e293b')
          .text('జలమిత్ర - సీజన్ నీటి వినియోగ నివేదిక', 30, 30, { align: 'center' });
        doc.font(fontBold).fontSize(12).fillColor('#334155')
          .text('JALAMITRA — SEASONAL WATER BALANCE & AUDIT REPORT', 30, 50, { align: 'center' });
        doc.font(fontRegular).fontSize(8).fillColor('#64748b')
          .text(`Report Code: ${report.reportCode} • Generated: ${new Date(report.createdAt).toLocaleDateString('en-IN')}`, 30, 68, { align: 'center' });

        // Ineligibility Alert Banner
        doc.rect(20, 105, pageWidth - 40, 80)
          .fillColor('#fffbeb')
          .strokeColor('#f59e0b')
          .lineWidth(1.5)
          .fillAndStroke();

        doc.font(fontBold).fontSize(11).fillColor('#b45309')
          .text('⚠️ INELIGIBLE FOR CONSERVATION CERTIFICATE (ధృవీకరణ పత్రానికి అర్హత పొందలేదు)', 32, 115);

        doc.font(fontRegular).fontSize(9).fillColor('#92400e')
          .text('This season completed cultivation, but did not satisfy the minimum data integrity or monitoring cycle thresholds required for an accredited Water Conservation Certificate:', 32, 132, { width: pageWidth - 64 });

        let rY = 150;
        for (const reason of report.ineligibilityReasons) {
          doc.font(fontBold).fontSize(8.5).fillColor('#b45309').text(`• ${reason}`, 40, rY, { width: pageWidth - 80 });
          rY += 14;
        }

        // Field & Farmer Profile
        let curY = 200;
        doc.font(fontBold).fontSize(11).fillColor('#0f172a').text('Cultivation & Field Profile', 24, curY);
        curY += 16;
        doc.rect(20, curY, pageWidth - 40, 60).fillColor('#f8fafc').strokeColor('#e2e8f0').lineWidth(0.5).fillAndStroke();

        doc.font(fontRegular).fontSize(9).fillColor('#334155');
        doc.text(`Farmer: ${s.farmer.fullName} (${s.farmer.villageName}, ${s.farmer.mandal})`, 30, curY + 10);
        doc.text(`Crop: ${s.crop.name} (${s.crop.nameTe}) • Plot: ${s.plot.label} (${s.plot.areaAcres} Acres)`, 30, curY + 25);
        doc.text(`Season: ${s.seasonType} ${s.seasonYear} • Harvest Date: ${report.actualHarvestDate}`, 30, curY + 40);

        // Water Metrics Table
        curY += 80;
        doc.font(fontBold).fontSize(11).fillColor('#0f172a').text('Water Metrics & Monitoring Summary', 24, curY);
        curY += 16;
        doc.rect(20, curY, pageWidth - 40, 100).fillColor('#ffffff').strokeColor('#cbd5e1').lineWidth(0.5).fillAndStroke();

        doc.font(fontBold).fontSize(9).fillColor('#1e293b');
        doc.text(`Monitoring Cycle Coverage: ${report.monitoringCycleCoverage.toFixed(1)}%`, 30, curY + 12);
        doc.text(`Data Confidence Score: ${Math.round(report.confidenceScore)}/100 (${report.confidenceBand.toUpperCase()})`, 30, curY + 28);
        doc.text(`Water Use Ratio (WUR): ${report.waterUseRatio.toFixed(2)} (${report.waterUseRatioBand})`, 30, curY + 44);
        doc.text(`Estimated Net Crop Demand: ${Math.round(s.waterMetrics.netIrrigationDemandMm)} mm`, 30, curY + 60);
        doc.text(`Farmer Reported Irrigation: ${Math.round(s.waterMetrics.totalAppliedMm)} mm (${s.irrigationRecordsSummary.totalHoursReported} pump hours)`, 30, curY + 76);

        // Footer note
        doc.font(fontRegular).fontSize(8).fillColor('#94a3b8')
          .text('This is an indicative CSP monitoring summary for agronomic audit only. It does not certify water conservation compliance.', 20, doc.page.height - 40, { align: 'center', width: pageWidth - 40 });

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Saves certificate PDF to local filesystem.
   */
  async saveCertificatePdf(certificate: CertificateRecord, baseUrl: string = config.PUBLIC_FRONTEND_URL): Promise<string> {
    const pdfDir = path.resolve(process.cwd(), 'storage/certificates');
    if (!fs.existsSync(pdfDir)) {
      fs.mkdirSync(pdfDir, { recursive: true });
    }

    const filePath = path.join(pdfDir, `${certificate.certificateCode}.pdf`);
    const buffer = await this.generateCertificatePdf(certificate, baseUrl);
    fs.writeFileSync(filePath, buffer);
    return filePath;
  }

  /**
   * Saves season report PDF to local filesystem.
   */
  async saveSeasonReportPdf(report: SeasonReportRecord): Promise<string> {
    const pdfDir = path.resolve(process.cwd(), 'storage/reports');
    if (!fs.existsSync(pdfDir)) {
      fs.mkdirSync(pdfDir, { recursive: true });
    }

    const filePath = path.join(pdfDir, `${report.reportCode}.pdf`);
    const buffer = await this.generateSeasonReportPdf(report);
    fs.writeFileSync(filePath, buffer);
    return filePath;
  }
}

export const pdfCertificateService = new PdfCertificateService();
