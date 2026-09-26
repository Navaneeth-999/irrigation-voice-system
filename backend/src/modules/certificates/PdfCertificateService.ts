import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { CertificateRecord } from './types.js';

export class PdfCertificateService {
  private fontRegularPath: string;
  private fontBoldPath: string;

  constructor() {
    this.fontRegularPath = path.resolve(process.cwd(), 'assets/fonts/NotoSansTelugu-Regular.ttf');
    this.fontBoldPath = path.resolve(process.cwd(), 'assets/fonts/NotoSansTelugu-Bold.ttf');
  }

  /**
   * Generates a high-resolution, bilingual PDF conservation certificate buffer.
   */
  async generateCertificatePdf(
    certificate: CertificateRecord,
    baseUrl: string = 'http://localhost:5173'
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

        // 3. Certificate Meta Bar (Code and Date)
        const metaY = 106;
        doc.rect(36, metaY, pageWidth - 72, 24)
          .fillColor('#f8fafc')
          .strokeColor('#e2e8f0')
          .lineWidth(1)
          .fillAndStroke();

        doc.font(fontBold).fontSize(9).fillColor('#0f172a')
          .text(`Certificate Code: ${certificate.certificateCode}`, 48, metaY + 7);

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
        printRow(col1X, rowY, 'District:', s.farmer.district);
        rowY += 18;
        printRow(col1X, rowY, 'Plot / Field:', `${s.plot.label} (${s.areaAcres} Acres)`);
        rowY += 18;
        printRow(col1X, rowY, 'Irrigation Method:', `${s.plot.irrigationMethod} (~${Math.round(s.plot.typicalEfficiency * 100)}% eff.)`);

        // --- Column 2: Crop & Water Metrics ---
        doc.font(fontBold).fontSize(11).fillColor('#1b4332')
          .text('SEASON & WATER PERFORMANCE (పంట & నీటి నిర్వహణ)', col2X, gridY);

        doc.rect(col2X, gridY + 16, colWidth, 110)
          .fillColor('#ffffff')
          .strokeColor('#cbd5e1')
          .lineWidth(0.5)
          .fillAndStroke();

        let row2Y = gridY + 24;
        printRow(col2X, row2Y, 'Crop Sown:', `${s.crop.name} (${s.crop.nameTe})`);
        row2Y += 18;
        printRow(col2X, row2Y, 'Season Period:', `${s.sowingDate} to ${s.actualHarvestDate} (${s.seasonType.toUpperCase()} ${s.seasonYear})`);
        row2Y += 18;

        const bandLabels: Record<string, string> = {
          near_estimate: 'Near Agronomic Target (సమాన వినియోగం)',
          below_estimate: 'Below Estimated Demand (తక్కువ వినియోగం)',
          above_estimate: 'Above Estimated Demand (ఎక్కువ వినియోగం)',
        };
        const bandText = bandLabels[s.waterMetrics.ratioBand] || s.waterMetrics.ratioBand;
        printRow(col2X, row2Y, 'Water Use Ratio:', `${s.waterMetrics.waterUseRatio} • ${bandText}`);
        row2Y += 18;

        printRow(col2X, row2Y, 'Applied Water:', `${s.waterMetrics.totalAppliedLitres.toLocaleString('en-IN')} L (~${s.waterMetrics.totalAppliedMm} mm)`);
        row2Y += 18;

        printRow(col2X, row2Y, 'Data Confidence:', `${Math.round(s.waterMetrics.confidenceScore)}/100 (${s.waterMetrics.confidenceBand.toUpperCase()})`);

        // 5. Scientific Assumptions & Disclaimers Box (Prominent Transparency Requirement)
        const unvalidatedList = s.waterMetrics.unvalidatedAssumptionsList || [];
        const boxY = 278;
        const boxHeight = 72;

        if (s.waterMetrics.hasUnvalidatedAssumptions && unvalidatedList.length > 0) {
          doc.rect(36, boxY, pageWidth - 72, boxHeight)
            .fillColor('#fffbeb') // Amber warning background
            .strokeColor('#f59e0b')
            .lineWidth(1)
            .fillAndStroke();

          doc.font(fontBold).fontSize(8.5).fillColor('#b45309')
            .text('⚠️ TECHNICAL DISCLAIMER — CALCULATIONS BASED ON UNVALIDATED SCIENTIFIC ASSUMPTIONS:', 46, boxY + 8);

          doc.font(fontRegular).fontSize(7.5).fillColor('#78350f');
          const maxAssumptions = unvalidatedList.slice(0, 3);
          let itemY = boxY + 22;
          for (const item of maxAssumptions) {
            doc.text(`• ${item}`, 50, itemY, { width: pageWidth - 100 });
            itemY += 11;
          }
          if (unvalidatedList.length > 3) {
            doc.text(`• ...and ${unvalidatedList.length - 3} other uncalibrated local parameter(s).`, 50, itemY);
          }
        } else {
          doc.rect(36, boxY, pageWidth - 72, boxHeight)
            .fillColor('#f0fdf4')
            .strokeColor('#86efac')
            .lineWidth(1)
            .fillAndStroke();

          doc.font(fontBold).fontSize(9).fillColor('#15803d')
            .text('✅ FULLY CALIBRATED AGRONOMIC PARAMETERS:', 46, boxY + 12);
          doc.font(fontRegular).fontSize(8.5).fillColor('#166534')
            .text('All crop evapotranspiration coefficients (Kc) and effective rainfall fractions were calibrated against published regional agricultural research baselines.', 46, boxY + 28, { width: pageWidth - 92 });
        }

        // 6. Verification Footer with QR Code & SHA-256 Hash
        const footerY = 362;
        const verifyUrl = `${baseUrl}/verify/${certificate.certificateCode}`;
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
   * Saves certificate PDF to local filesystem.
   */
  async saveCertificatePdf(certificate: CertificateRecord, baseUrl?: string): Promise<string> {
    const pdfDir = path.resolve(process.cwd(), 'storage/certificates');
    if (!fs.existsSync(pdfDir)) {
      fs.mkdirSync(pdfDir, { recursive: true });
    }

    const filePath = path.join(pdfDir, `${certificate.certificateCode}.pdf`);
    const buffer = await this.generateCertificatePdf(certificate, baseUrl);
    fs.writeFileSync(filePath, buffer);
    return filePath;
  }
}

export const pdfCertificateService = new PdfCertificateService();
