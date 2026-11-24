import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads', 'products');

/**
 * RF-02.2: Automatically resizes uploaded product images to 256×256 px and converts to .webp
 * so the catalog stays tiny and loads instantaneously.
 */
export async function processAndSaveProductImage(
  base64DataUrl: string,
  skuHint = 'prod'
): Promise<{ image_path: string; size_bytes: number }> {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  const match = base64DataUrl.match(/^data:([^;]+);base64,(.+)$/);
  const rawBuffer = Buffer.from(match ? match[2] : base64DataUrl, 'base64');

  const safeSlug = skuHint.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'prod';
  const filename = `${safeSlug}_${Date.now()}.webp`;
  const filepath = path.join(UPLOADS_DIR, filename);

  const webpBuffer = await sharp(rawBuffer)
    .resize(256, 256, { fit: 'cover', position: 'centre' })
    .webp({ quality: 82 })
    .toBuffer();

  fs.writeFileSync(filepath, webpBuffer);

  return {
    image_path: `/uploads/products/${filename}`,
    size_bytes: webpBuffer.length,
  };
}
