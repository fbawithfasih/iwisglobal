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
  { slug: 'fatehpur-sikri', name: 'Fatehpur Sikri', x: 9, y: 70, match: /fatehpur/i },
  { slug: 'agra-fort', name: 'Agra Fort', x: 36, y: 66, match: /agra fort|red fort/i },
  { slug: 'itimad-ud-daulah', name: 'Itimad-ud-Daulah', x: 44, y: 22, match: /itimad|baby taj/i },
  { slug: 'taj-mahal', name: 'Taj Mahal', x: 71, y: 68, match: /taj mahal|\btaj\b/i },
  { slug: 'mehtab-bagh', name: 'Mehtab Bagh', x: 80, y: 24, match: /mehtab/i },
];

// Which sites a piece of itinerary text mentions. "Taj" alone also matches,
// but "Baby Taj" is the Itimad-ud-Daulah nickname, so it is removed first.
export function sitesInText(text: string): string[] {
  const clean = text.replace(/baby taj/gi, '');
  return AGRA_SITES.filter((s) => (s.slug === 'itimad-ud-daulah' ? s.match.test(text) : s.match.test(clean))).map((s) => s.slug);
}
