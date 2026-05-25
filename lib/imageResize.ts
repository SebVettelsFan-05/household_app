/**
 * Client-side receipt prep.
 *
 * Phone-camera shots can be 4–6 MB easily, which blows past Vercel's
 * serverless body limit. We downscale to a sane max edge length and
 * re-encode as JPEG so the upload stays under ~500 KB for typical
 * receipts. PDFs / unsupported types pass through unchanged — they're
 * usually already small.
 */

const MAX_EDGE_PX = 1600;
const JPEG_QUALITY = 0.85;

export type PreparedReceipt = {
  blob: Blob;
  filename: string;
};

export async function prepareReceipt(file: File): Promise<PreparedReceipt> {
  if (!file.type.startsWith("image/")) {
    return { blob: file, filename: file.name || "receipt" };
  }

  const dataUrl = await readAsDataUrl(file);
  const img = await loadImage(dataUrl);

  // No resize needed when the image is already small enough — re-encoding
  // a small image as JPEG would just lose detail for nothing.
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  if (longest <= MAX_EDGE_PX && /jpe?g$/i.test(file.type.split("/")[1] || "")) {
    return { blob: file, filename: file.name || "receipt.jpg" };
  }

  const scale = longest > MAX_EDGE_PX ? MAX_EDGE_PX / longest : 1;
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    // No 2D context (very old browser or hardened sandbox) — skip resize,
    // upstream code will reject if the file is too large.
    return { blob: file, filename: file.name || "receipt" };
  }
  ctx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", JPEG_QUALITY);
  });
  if (!blob) {
    return { blob: file, filename: file.name || "receipt" };
  }

  const baseName = (file.name || "receipt").replace(/\.[^/.]+$/, "");
  return { blob, filename: `${baseName}.jpg` };
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error || new Error("File read failed"));
    fr.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't decode the image"));
    img.src = src;
  });
}
