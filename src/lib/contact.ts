// Tap-to-contact links for admin pages (leads, bookings).

// tel: works with any number format.
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

// WhatsApp needs the full international number, so only offer it when the
// number was saved with a leading "+" (the website booking form asks for the
// country code). Optional pre-filled message.
export function waHref(phone: string, text?: string): string | null {
  if (!phone.trim().startsWith('+')) return null;
  const base = `https://wa.me/${phone.replace(/\D/g, '')}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
