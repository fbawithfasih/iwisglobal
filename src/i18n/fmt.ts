// "{n} days" style placeholders: fmt(t.x.days, { n: 3 }). Kept apart from
// dictionaries.ts so browser components can use it without bundling every
// language.
export function fmt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
}
