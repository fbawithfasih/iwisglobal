// Positions for the schematic Agra map, plus the keywords that tie an
// itinerary stop to a site. Coordinates are percentages of a drawn map, not
// real geography: the map says so on its face. The relative layout is true
// (Fort and Taj on the right bank of the Yamuna, Itimad-ud-Daulah and
// Mehtab Bagh across it), distances are not. Slugs match src/content/attractions.

export interface AgraSite {
  slug: string;
  name: string;
  x: number; // % from left
  y: number; // % from top
  match: RegExp;
}

export const AGRA_SITES: AgraSite[] = [
  { slug: 'fatehpur-sikri', name: 'Fatehpur Sikri', x: 25, y: 88, match: /fatehpur/i },
  { slug: 'agra-fort', name: 'Agra Fort', x: 42, y: 62, match: /agra fort|red fort/i },
  { slug: 'itimad-ud-daulah', name: 'Itimad-ud-Daulah', x: 32, y: 18, match: /itimad|baby taj/i },
  { slug: 'taj-mahal', name: 'Taj Mahal', x: 80, y: 74, match: /taj mahal|\btaj\b/i },
  { slug: 'mehtab-bagh', name: 'Mehtab Bagh', x: 74, y: 32, match: /mehtab/i },
];

// Which sites a piece of itinerary text mentions. "Taj" alone also matches,
// but "Baby Taj" is the Itimad-ud-Daulah nickname, so it is removed first.
export function sitesInText(text: string): string[] {
  const clean = text.replace(/baby taj/gi, '');
  return AGRA_SITES.filter((s) => (s.slug === 'itimad-ud-daulah' ? s.match.test(text) : s.match.test(clean))).map((s) => s.slug);
}
