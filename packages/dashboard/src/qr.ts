/**
 * QR rendering (the dashboard's only runtime dependency). The QR encodes the
 * `obsidian://` pair deep link so a phone camera completes pairing with zero
 * typing (§3).
 */
import QRCode from 'qrcode';

export async function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
}

export async function qrImage(text: string): Promise<HTMLImageElement> {
  const dataUrl = await qrDataUrl(text);
  const image = new Image();
  image.src = dataUrl;
  image.alt = 'Pairing QR code';
  image.width = 240;
  image.height = 240;
  return image;
}
