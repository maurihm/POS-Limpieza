import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { getDefaultPriceTier, listCategories, listProducts } from '../services/inventory.ts';
import { getSettings } from '../db/database.ts';
import { fmtMoney } from '../hardware/escpos.ts';

/**
 * RF-07.3: Generates a print-ready US Letter PDF grid of QR scan cards
 * (Product Image + Name + Price + Scannable QR Code) for a selected category or all products.
 */
export async function generateQrSheetPdf(
  db: DatabaseSync,
  options: { categoryId?: number; tierId?: number } = {}
): Promise<Buffer> {
  const settings = getSettings(db);
  const defaultTier = getDefaultPriceTier(db);
  const tierId = options.tierId || defaultTier.id;
  const products = listProducts(db, { includeInactive: false, categoryId: options.categoryId });
  const categories = listCategories(db, true);
  const catName = options.categoryId
    ? categories.find((c) => c.id === options.categoryId)?.name || 'Catálogo'
    : 'Todos los Productos';

  // Pre-generate QR PNG buffers in parallel
  const qrBuffers = await Promise.all(
    products.map((p) => {
      const code = p.barcode || p.sku;
      return QRCode.toBuffer(code, { width: 160, margin: 1, errorCorrectionLevel: 'M' });
    })
  );

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 36 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const drawPageHeader = () => {
      doc
        .font('Helvetica-Bold')
        .fontSize(15)
        .fillColor('#0F172A')
        .text(`${settings.business_name} — Hoja de Escaneo QR (${catName})`, 36, 26);
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#64748B')
        .text(`Total: ${products.length} productos  |  Generado: ${new Date().toLocaleDateString('es-MX')}`, 36, 44);
      doc.moveTo(36, 58).lineTo(576, 58).strokeColor('#CBD5E1').lineWidth(0.75).stroke();
    };

    drawPageHeader();

    const cols = 3;
    const rowsPerPage = 4;
    const cardsPerPage = cols * rowsPerPage;
    const cardW = 172;
    const cardH = 166;
    const gapX = 12;
    const gapY = 12;
    const startX = 36;
    const startY = 68;

    products.forEach((p, index) => {
      if (index > 0 && index % cardsPerPage === 0) {
        doc.addPage();
        drawPageHeader();
      }
      const posInPage = index % cardsPerPage;
      const col = posInPage % cols;
      const row = Math.floor(posInPage / cols);
      const x = startX + col * (cardW + gapX);
      const y = startY + row * (cardH + gapY);

      // Card border
      doc
        .roundedRect(x, y, cardW, cardH, 8)
        .fillAndStroke('#FFFFFF', '#CBD5E1');

      // QR Code (right side)
      doc.image(qrBuffers[index], x + cardW - 92, y + 48, { width: 82, height: 82 });

      // Product image thumbnail (left side) if local PNG/JPG exists
      const imgFile = p.image_path
        ? path.resolve(process.cwd(), p.image_path.replace(/^\//, ''))
        : null;
      const canEmbedImg =
        imgFile && fs.existsSync(imgFile) && /\.(png|jpe?g)$/i.test(imgFile);

      if (canEmbedImg) {
        try {
          doc.image(imgFile, x + 10, y + 52, { fit: [64, 64] });
        } catch {
          // ignore unsupported format
        }
      } else {
        doc
          .roundedRect(x + 10, y + 52, 62, 62, 6)
          .fillAndStroke('#F1F5F9', '#E2E8F0');
        doc
          .font('Helvetica-Bold')
          .fontSize(14)
          .fillColor('#64748B')
          .text(p.sku.slice(0, 3), x + 10, y + 74, { width: 62, align: 'center' });
      }

      // Product name
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor('#0F172A')
        .text(p.name, x + 10, y + 10, { width: cardW - 20, height: 28, ellipsis: true });

      // Price badge
      const priceCents = p.prices[tierId] ?? p.prices[defaultTier.id] ?? 0;
      doc
        .font('Helvetica-Bold')
        .fontSize(13)
        .fillColor('#16A34A')
        .text(fmtMoney(priceCents), x + 10, y + 124, { width: 70 });

      // Code label under QR
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor('#475569')
        .text(p.barcode || p.sku, x + cardW - 96, y + 134, { width: 88, align: 'center' });

      // Unit tag
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor('#64748B')
        .text(`${p.sku} · ${p.unit_type === 'LITER' ? 'Litro' : p.unit_type === 'WEIGHT' ? 'Kg' : 'Pza'}`, x + 10, y + 146, {
          width: cardW - 20,
        });
    });

    doc.end();
  });
}
