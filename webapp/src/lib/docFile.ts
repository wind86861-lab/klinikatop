/**
 * Hujjat faylini yuborishga tayyorlash — klinika litsenziyasi va
 * shifokor diplomi uchun umumiy.
 */

/** Server chegarasi bilan bir xil — oshsa yuborishdan OLDIN aytamiz */
export const MAX_LICENSE_BYTES = 8 * 1024 * 1024;

export interface LicenseFile {
  name: string;
  size: number;
  isPdf: boolean;
  dataBase64: string;
  /** Rasm bo'lsa — kichik ko'rinish */
  preview: string | null;
}

const readAsDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/**
 * Telefon kamerasi kadri 5–10 MB bo'ladi — sekin internetda ariza
 * yuborilmay qolardi. Katta rasm brauzerning o'zida siqiladi: matn
 * o'qilishi uchun 2400 px yetarli. HEIC'ni ko'p brauzer chiza olmaydi —
 * u o'zgarishsiz yuboriladi (server qabul qiladi).
 */
export async function prepareLicense(file: File): Promise<LicenseFile> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  let blob: Blob = file;
  let name = file.name;

  if (!isPdf && file.type.startsWith('image/') && file.type !== 'image/heic' && file.size > 1.5 * 1024 * 1024) {
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
      if (out && out.size < file.size) {
        blob = out;
        name = name.replace(/\.[^.]+$/, '') + '.jpg';
      }
    } catch {
      /* chizib bo'lmadi — asl fayl yuboriladi */
    }
  }

  if (blob.size > MAX_LICENSE_BYTES) throw new Error('Fayl 8 MB dan katta. Kichikroq fayl tanlang.');

  const dataUrl = await readAsDataUrl(blob);
  return {
    name,
    size: blob.size,
    isPdf,
    dataBase64: dataUrl.split(',')[1] ?? '',
    preview: isPdf ? null : dataUrl,
  };
}

export const formatSize = (n: number) =>
  n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
