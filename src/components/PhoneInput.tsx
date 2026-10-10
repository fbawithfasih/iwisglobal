import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  countryByIso,
  flagSrc,
  formatPhone,
  getCountries,
  guessCountry,
  parseInternational,
  type Country,
} from '../lib/countries';

// Country-code picker (flag + calling code) in front of the number box. The
// parent still gets one string, "+<code> <number>", so the rest of the booking
// flow (validation, payment prefill, WhatsApp) is unchanged. Flags are small
// self-hosted SVGs because many Windows browsers can't draw flag emoji.

interface Props {
  id: string;
  // Controlled use (the booking form passes value + onChange), or standalone
  // inside a plain HTML form: pass `name` and the combined number is posted
  // through a hidden field.
  value?: string;
  onChange?: (value: string) => void;
  name?: string;
  invalid?: boolean;
  describedBy?: string;
}

function Flag({ iso }: { iso: string }) {
  return (
    <img
      src={flagSrc(iso)}
      alt=""
      width={20}
      height={14}
      loading="lazy"
      decoding="async"
      className="h-3.5 w-5 shrink-0 rounded-[2px] object-cover shadow-[0_0_0_1px_rgba(0,0,0,0.15)]"
      onError={(e) => {
        e.currentTarget.style.visibility = 'hidden';
      }}
    />
  );
}

type Row = { kind: 'country'; key: string; country: Country } | { kind: 'heading'; key: string; label: string };

export default function PhoneInput({ id, value, onChange, name, invalid = false, describedBy }: Props) {
  const listId = useId();
  const { all, popular } = useMemo(getCountries, []);
  const [country, setCountry] = useState<Country>(() => countryByIso('IN'));
  const [national, setNational] = useState('');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const touched = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const numberRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Start from the visitor's own country when we can tell (en-GB -> United
  // Kingdom), unless they have already picked or typed something.
  useEffect(() => {
    if (touched.current || value) return;
    const guess = guessCountry();
    if (guess) setCountry(guess);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows: Row[] = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\+/, '');
    if (q) {
      return all
        .filter((c) => c.name.toLowerCase().includes(q) || c.dial.startsWith(q) || c.iso.toLowerCase() === q)
        .map((c) => ({ kind: 'country' as const, key: `s-${c.iso}`, country: c }));
    }
    return [
      { kind: 'heading' as const, key: 'h-popular', label: 'Popular' },
      ...popular.map((c) => ({ kind: 'country' as const, key: `p-${c.iso}`, country: c })),
      { kind: 'heading' as const, key: 'h-all', label: 'All countries' },
      ...all.map((c) => ({ kind: 'country' as const, key: `a-${c.iso}`, country: c })),
    ];
  }, [query, all, popular]);

  const options = rows.filter((r): r is Extract<Row, { kind: 'country' }> => r.kind === 'country');

  // Close when clicking or tapping outside.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);

  // Keep the highlighted row in view while arrowing through the list.
  useEffect(() => {
    if (!open || !options[active]) return;
    document.getElementById(`${listId}-${options[active].key}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, options, listId]);

  function openList() {
    setQuery('');
    const current = options.findIndex((o) => o.country.iso === country.iso);
    setActive(Math.max(0, current));
    setOpen(true);
    // The search box takes focus once it exists.
    setTimeout(() => searchRef.current?.focus(), 0);
  }

  function pick(c: Country) {
    touched.current = true;
    setCountry(c);
    setOpen(false);
    onChange?.(formatPhone(c, national));
    numberRef.current?.focus();
  }

  function typeNumber(raw: string) {
    touched.current = true;
    // A pasted or typed "+44 7700 900123" picks the country by itself.
    if (raw.trim().startsWith('+')) {
      const parsed = parseInternational(raw, country);
      setCountry(parsed.country);
      setNational(parsed.national);
      onChange?.(formatPhone(parsed.country, parsed.national));
      return;
    }
    const cleaned = raw.replace(/[^\d\s().-]/g, '');
    setNational(cleaned);
    onChange?.(formatPhone(country, cleaned));
  }

  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (options[active]) pick(options[active].country);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  const border = invalid ? 'border-red-500' : 'border-stone-300';

  return (
    <div ref={rootRef} className="relative">
      <div className={`flex rounded border bg-white focus-within:ring-2 focus-within:ring-brand-400 ${border}`}>
        <button
          ref={buttonRef}
          type="button"
          onClick={() => (open ? setOpen(false) : openList())}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-label={`Country code: ${country.name}, plus ${country.dial}. Change country`}
          className="flex shrink-0 items-center gap-1.5 rounded-l border-r border-stone-300 px-2.5 py-2 text-base hover:bg-stone-50 focus:outline-none"
        >
          <Flag iso={country.iso} />
          <span className="tabular-nums text-stone-800">+{country.dial}</span>
          <svg viewBox="0 0 20 20" className="h-4 w-4 text-stone-500" fill="currentColor" aria-hidden="true">
            <path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z" />
          </svg>
        </button>
        <input
          ref={numberRef}
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="Phone number"
          value={national}
          onChange={(e) => typeNumber(e.target.value)}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className="min-w-0 flex-1 rounded-r bg-transparent px-3 py-2 text-base focus:outline-none"
        />
      </div>

      {name && <input type="hidden" name={name} value={formatPhone(country, national)} />}

      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-lg border border-stone-200 bg-white shadow-xl">
          <div className="border-b border-stone-100 p-2">
            <input
              ref={searchRef}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={options[active] ? `${listId}-${options[active].key}` : undefined}
              aria-label="Search countries by name or code"
              placeholder="Search country or code"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onSearchKey}
              autoComplete="off"
              className="w-full rounded border border-stone-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          <ul id={listId} role="listbox" aria-label="Countries" className="max-h-64 overflow-y-auto overscroll-contain py-1">
            {options.length === 0 && <li className="px-3 py-3 text-sm text-stone-500">No country found</li>}
            {rows.map((row) => {
              if (row.kind === 'heading') {
                return (
                  <li key={row.key} role="presentation" className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                    {row.label}
                  </li>
                );
              }
              const index = options.findIndex((o) => o.key === row.key);
              const isActive = index === active;
              const isSelected = row.country.iso === country.iso;
              return (
                <li
                  key={row.key}
                  id={`${listId}-${row.key}`}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActive(index)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(row.country)}
                  className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm ${isActive ? 'bg-brand-50' : ''} ${isSelected ? 'font-semibold' : ''}`}
                >
                  <Flag iso={row.country.iso} />
                  <span className="min-w-0 flex-1 truncate">{row.country.name}</span>
                  <span className="tabular-nums text-stone-500">+{row.country.dial}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
