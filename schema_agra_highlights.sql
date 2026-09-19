-- Moves the homepage "Top things to do in Agra" carousel from a hardcoded
-- array in index.astro into D1, manageable from /admin/agra-highlights
-- without a redeploy — same pattern as schema_tours.sql.

CREATE TABLE IF NOT EXISTS agra_highlights (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Migrate the existing hardcoded items so the homepage doesn't change until
-- an admin edits something.
INSERT OR IGNORE INTO agra_highlights (id, name, description, image, sort_order, created_at, updated_at) VALUES
  ('TAJ_MAHAL', 'Taj Mahal', 'The white marble mausoleum built by Emperor Shah Jahan — a UNESCO World Heritage Site and the centerpiece of every Agra visit.', '/hero-taj-mahal.jpg', 0, '2026-09-19T00:00:00.000Z', '2026-09-19T00:00:00.000Z'),
  ('AGRA_FORT', 'Agra Fort', 'A UNESCO-listed red sandstone Mughal fortress on the banks of the Yamuna, once the seat of the Mughal emperors.', '', 1, '2026-09-19T00:00:00.000Z', '2026-09-19T00:00:00.000Z'),
  ('FATEHPUR_SIKRI', 'Fatehpur Sikri', 'A UNESCO World Heritage ghost city built by Emperor Akbar as his short-lived capital, about 40km from Agra.', '', 2, '2026-09-19T00:00:00.000Z', '2026-09-19T00:00:00.000Z'),
  ('MEHTAB_BAGH', 'Mehtab Bagh', 'A Mughal garden directly across the river from the Taj Mahal, known for sunset views of the monument.', '', 3, '2026-09-19T00:00:00.000Z', '2026-09-19T00:00:00.000Z'),
  ('ITMAD_UD_DAULAH', 'Itmad-ud-Daulah''s Tomb', 'Known as the "Baby Taj," this marble tomb is considered a design precursor to the Taj Mahal.', '', 4, '2026-09-19T00:00:00.000Z', '2026-09-19T00:00:00.000Z'),
  ('MARBLE_WORKSHOPS', 'Agra marble-inlay workshops', 'Local ateliers practicing pietra dura, the marble-inlay craft used to decorate the Taj Mahal itself.', '', 5, '2026-09-19T00:00:00.000Z', '2026-09-19T00:00:00.000Z');
