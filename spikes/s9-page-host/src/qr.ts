// Join QR codes drawn in the page (the Node host served /qr.svg; S9 has no host server).
import QRCode from 'qrcode';

/** SVG markup of a QR code for `text` (dark on white, 1-module quiet zone). */
export function qrSvg(text: string, margin = 1): string {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const data = qr.modules.data;
  let d = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!data[y * n + x]) continue;
      // Merge horizontal runs into one rectangle: ~3× smaller markup.
      let w = 1;
      while (x + w < n && data[y * n + x + w]) w++;
      d += `M${x + margin} ${y + margin}h${w}v1h${-w}z`;
      x += w - 1;
    }
  }
  const s = n + 2 * margin;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/** `<img src>` for a join QR. */
export function qrDataUrl(text: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg(text))}`;
}
