import { useEffect, useReducer } from 'react';

// The school's logo tag (changes when the logo does) per school, set by the app shell when a school is opened
// or its logo is changed, so printouts anywhere can show the crest without fetching the school again.
const tags = new Map<string, string | null>();
const listeners = new Set<() => void>();
export function setLogoTag(schoolId: string, tag: string | null) { tags.set(schoolId, tag); listeners.forEach(listener => listener()); }

export function SchoolLogo({ schoolId, className = 'school-logo' }: { schoolId: string; className?: string }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => { listeners.add(rerender); return () => { listeners.delete(rerender); }; }, []);
  const tag = tags.get(schoolId);
  return tag ? <img className={className} src={`/api/v1/schools/${schoolId}/logo?v=${tag}`} alt=""/> : null;
}

// Shrinks a chosen picture to at most 256px on its longer side and returns a data URL small enough to save
// (PNG keeps a transparent background; a photo that is still too large is saved as JPEG instead).
export async function shrinkLogo(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Choose a PNG, JPEG or WebP picture.');
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('That picture could not be opened.')); img.src = url; });
    const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const [type, quality] of [['image/png', undefined], ['image/webp', 0.9], ['image/jpeg', 0.85], ['image/jpeg', 0.7]] as const) {
      // JPEG has no transparency: put the picture on white so a clear background does not turn black.
      if (type === 'image/jpeg' && context.globalCompositeOperation !== 'destination-over') { context.globalCompositeOperation = 'destination-over'; context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); }
      const data = canvas.toDataURL(type, quality);
      if (data.startsWith(`data:${type}`) && data.length <= 98000) return data;
    }
    throw new Error('That picture is too detailed to use as a logo. Try a simpler one.');
  } finally { URL.revokeObjectURL(url); }
}
