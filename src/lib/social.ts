// IWIS Global's official social profiles (confirmed by the owner, 1 Oct
// 2026; Pinterest 2 Oct). One list for the footer, the Contact page and the Organization
// JSON-LD sameAs, so they can't drift apart.
export const SOCIAL_PROFILES = [
  { name: 'Facebook', url: 'https://www.facebook.com/iwisglobal/' },
  { name: 'Instagram', url: 'https://www.instagram.com/iwisglobaltours/' },
  { name: 'LinkedIn', url: 'https://www.linkedin.com/company/iwisglobal/' },
  { name: 'X', url: 'https://x.com/iwisglobal' },
  // Given as in.pinterest.com (India); the main domain is the same profile
  // and redirects each visitor to their own country's site.
  { name: 'Pinterest', url: 'https://www.pinterest.com/iwisglobal/' },
] as const;

export type SocialName = (typeof SOCIAL_PROFILES)[number]['name'];
