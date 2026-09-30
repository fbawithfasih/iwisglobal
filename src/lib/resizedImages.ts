// Smaller copies of uploaded card photos, self-hosted in public/ (Cloudflare
// Image Transformations isn't active on the zone, and our API token can't
// write to R2). Uploads are ~1200 px but show as cards a few hundred px
// wide. Keyed by the upload's file id, so a photo replaced in admin (new id)
// simply falls back to the full-size upload until copies are made for it:
// save <id>-480.webp and <id>-800.webp in the folder below and add the id
// with the upload's width and height.
const COPIES: Record<string, { dir: string; ids: Record<string, [width: number, height: number]> }> = {
  'agra-highlights': {
    dir: '/agra-highlights',
    ids: {
      'f2a6b315-3c45-48dc-9d67-69ac1f6c7a67': [1200, 1200],
      'b5870a3b-2e17-41f3-8e25-0544a9d4f156': [1200, 900],
      '97aa9d29-f4d1-406a-8234-20e0b024bfbc': [1200, 900],
      '70661fe9-799e-44c6-ba50-0910110b9a27': [1200, 1200],
      'be03c4be-a53a-41f0-95c4-b5560485ecdd': [1200, 1200],
    },
  },
  tours: {
    dir: '/tour-images',
    ids: {
      '591c8a76-9187-4656-9dd2-34f2d64343a6': [1200, 670],
      '293ed4aa-41d7-47d3-948c-f67733af357d': [1200, 670],
      '05f85eb8-9ed8-4ec8-9fb5-ce8a37df0bfe': [1200, 514],
      '96f89e14-d67f-43cc-886b-bd45091d9659': [1200, 514],
      '88296783-ad03-4e89-a6f8-c018a384f9f4': [1080, 1350],
    },
  },
};

function lookup(image: string) {
  const match = /^\/images\/([a-z-]+)\/([0-9a-f-]+)\.webp$/.exec(image);
  const set = match ? COPIES[match[1]] : undefined;
  const size = match && set ? set.ids[match[2]] : undefined;
  return match && set && size ? { dir: set.dir, id: match[2], size } : undefined;
}

// srcset for an uploaded image URL (/images/<folder>/<id>.webp), or
// undefined when there are no copies for it. The upload itself is the
// largest candidate, for high-density screens.
export function resizedSrcset(image: string): string | undefined {
  const found = lookup(image);
  if (!found) return undefined;
  const { dir, id, size } = found;
  return `${dir}/${id}-480.webp 480w, ${dir}/${id}-800.webp 800w, ${image} ${size[0]}w`;
}

// The upload's pixel size, so a page can reserve its space before it loads.
export function uploadedImageSize(image: string): { width: number; height: number } | undefined {
  const found = lookup(image);
  return found ? { width: found.size[0], height: found.size[1] } : undefined;
}
