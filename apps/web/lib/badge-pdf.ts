const encode = (text: string) => new TextEncoder().encode(text);
const mmToPt = (mm: number) => mm * 72 / 25.4;

/** One physical portrait 54 x 86 mm page; the badge image is rendered at 300 dpi. */
export function createBadgePdf(jpeg: Uint8Array, pixelWidth: number, pixelHeight: number): Uint8Array {
  const width = mmToPt(54).toFixed(5), height = mmToPt(86).toFixed(5);
  const chunks: Uint8Array[] = [], offsets = [0];
  let length = 0;
  const append = (part: string | Uint8Array) => { const bytes = typeof part === 'string' ? encode(part) : part; chunks.push(bytes); length += bytes.length; };
  const object = (id: number, body: string | Uint8Array[]) => {
    offsets[id] = length; append(`${id} 0 obj\n`);
    if (typeof body === 'string') append(body); else body.forEach(append);
    append('\nendobj\n');
  };
  append('%PDF-1.4\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Badge 4 0 R >> >> /Contents 5 0 R >>`);
  object(4, [encode(`<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, encode('\nendstream')]);
  const content = `q\n${width} 0 0 ${height} 0 0 cm\n/Badge Do\nQ`;
  object(5, `<< /Length ${encode(content).length} >>\nstream\n${content}\nendstream`);
  const xref = length;
  append('xref\n0 6\n0000000000 65535 f \n');
  for (let id = 1; id <= 5; id++) append(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  append(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const pdf = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { pdf.set(chunk, offset); offset += chunk.length; }
  return pdf;
}

export async function downloadBadgePdf(svg: string, employeeName: string) {
  const source = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Не удалось подготовить бейдж.')); image.src = source; });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(54 / 25.4 * 300); canvas.height = Math.round(86 / 25.4 * 300);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось подготовить PDF.');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const binary = atob(canvas.toDataURL('image/jpeg', 1).split(',')[1]!);
    const jpeg = Uint8Array.from(binary, character => character.charCodeAt(0));
    const pdf = createBadgePdf(jpeg, canvas.width, canvas.height);
    const target = URL.createObjectURL(new Blob([pdf.buffer as ArrayBuffer], { type: 'application/pdf' }));
    const link = document.createElement('a'); link.href = target;
    link.download = `badge-${employeeName.replace(/[^\p{L}\p{N}_-]+/gu, '-')}.pdf`;
    link.click(); setTimeout(() => URL.revokeObjectURL(target), 1000);
  } finally { URL.revokeObjectURL(source); }
}
