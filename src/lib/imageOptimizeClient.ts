// Client-side resize/recompress before upload — fixes the root cause of a
// 7.5MB PageSpeed Insights finding (mobile LCP 18.4s): admin image uploads
// were stored and served completely raw (up to 5MB, whatever resolution
// the source file was), regardless of the ~445x445 display size these
// images actually render at. Runs entirely in the browser via Canvas — no
// server-side image-processing dependency, since Cloudflare Workers can't
// run a native library like sharp anyway. Used by the 4 admin upload forms
// (tours/new, tours/[id]/edit, agra-highlights/new, agra-highlights/[id]/edit).
const MAX_WIDTH = 1200;
const WEBP_QUALITY = 0.82;
// Optional small copy for list pages (the blog list shows covers ~330px wide).
const THUMB_WIDTH = 800;
const THUMB_QUALITY = 0.75;

// thumbInput: a hidden file input that receives the 800px copy, when the
// form stores one (blog covers).
export function attachImageOptimizer(
  input: HTMLInputElement,
  statusEl?: HTMLElement | null,
  thumbInput?: HTMLInputElement | null
) {
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    // Animated GIFs would lose their animation through a canvas round-trip
    // (only the first frame survives) — leave those alone.
    if (!file || !file.type.startsWith('image/') || file.type === 'image/gif') return;

    if (statusEl) statusEl.textContent = 'Optimizing…';
    if (thumbInput) thumbInput.value = '';

    try {
      const optimized = await resizeAndCompress(file, MAX_WIDTH, WEBP_QUALITY);
      // Only swap in the optimized version if it's actually smaller — an
      // already-small, already-compressed source image could theoretically
      // grow slightly from a fresh WebP re-encode.
      const finalFile = optimized.size < file.size ? optimized : file;
      const dt = new DataTransfer();
      dt.items.add(finalFile);
      input.files = dt.files;
      if (thumbInput) {
        const thumb = await resizeAndCompress(file, THUMB_WIDTH, THUMB_QUALITY);
        const tdt = new DataTransfer();
        tdt.items.add(thumb);
        thumbInput.files = tdt.files;
      }
      if (statusEl) {
        const before = (file.size / 1024).toFixed(0);
        const after = (finalFile.size / 1024).toFixed(0);
        statusEl.textContent =
          finalFile === optimized ? `Optimized: ${before} KB → ${after} KB` : `${before} KB (already small — kept as-is)`;
      }
    } catch {
      // Resizing failed for any reason (unsupported format, browser quirk)
      // — fall back to the original file rather than blocking the upload.
      if (statusEl) statusEl.textContent = '';
    }
  });
}

function resizeAndCompress(file: File, maxWidth: number, quality: number): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxWidth / img.width);
      const width = Math.round(img.width * scale);
      const height = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas not supported'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Encoding failed'));
            return;
          }
          const newName = file.name.replace(/\.[^.]+$/, '') + '.webp';
          resolve(new File([blob], newName, { type: 'image/webp' }));
        },
        'image/webp',
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}
