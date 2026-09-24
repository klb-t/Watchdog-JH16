import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { BookOpen, Circle, Database, FlaskConical, FolderKanban, LayoutDashboard, PlayCircle, Settings, Sparkles } from 'lucide-react';
import raw from '../../config/ui/navigation.json';
import { NavigationSchema, locate, visibleNavigation, type NavigationArea, type NavigationLanguage, type NavigationView } from '../../shared/navigation';
import { pickLanguage } from './access_i18n';
import { useAccess } from './access';

/**
 * Spec 14 in the browser: the parsed navigation config, the areas this viewer
 * may see, and the pieces of chrome built on it (area landing, command palette).
 * Parsing happens once at load, so a malformed config fails loudly instead of
 * silently hiding a page.
 */
export const NAVIGATION = NavigationSchema.parse(raw);

export function useNavigationModel() {
  const access = useAccess();
  const lang = pickLanguage() as NavigationLanguage;
  const visible = useMemo(() => visibleNavigation(NAVIGATION, access.capabilities), [access.capabilities]);
  const text = (key: string) => NAVIGATION.strings[lang][key] ?? NAVIGATION.strings.en[key] ?? key;
  return { ...visible, lang, text, locate: (pathname: string) => locate(NAVIGATION, pathname) };
}

/** Named explicitly so the bundle carries only these; tests/unit/navigation.test.ts checks the config uses no other. */
export const AREA_ICONS = { BookOpen, Database, FlaskConical, FolderKanban, LayoutDashboard, PlayCircle, Settings, Sparkles } as const;

export function AreaIcon({ name, className }: { name: string; className?: string }) {
  const Icon = (AREA_ICONS as Record<string, typeof Circle>)[name] ?? Circle;
  return <Icon className={className} aria-hidden="true" />;
}

/** Where an area link goes: its own path when that is a view, otherwise its first visible view. */
export function areaTarget(area: NavigationArea): string {
  return area.views.some(v => v.path === area.path) ? area.path : area.views[0].path;
}

/** `/data`, `/analysis`…: open the first view this viewer may see, or say there is none. */
export function AreaLanding({ areaId }: { areaId: string }) {
  const nav = useNavigationModel();
  const area = [...nav.areas, ...(nav.settings ? [nav.settings] : [])].find(a => a.id === areaId);
  if (area) return <Navigate to={areaTarget(area)} replace />;
  return <div className="p-6" data-testid="access-denied">
    <p className="text-sm text-slate-600">{nav.text('area_unavailable')}</p>
  </div>;
}

function fold(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase();
}

type Entry = { area: NavigationArea; view: NavigationView; title: string };

/** Ctrl/Cmd+K: every view this viewer may open, searchable by area and view name in either language. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigationModel();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const entries: Entry[] = useMemo(() => [...nav.areas, ...(nav.settings ? [nav.settings] : [])].flatMap(area =>
    area.views.map(view => ({ area, view, title: `${area.label[nav.lang]} › ${view.label[nav.lang]}` }))), [nav.areas, nav.settings, nav.lang]);
  const found = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return entries;
    return entries.filter(e => fold([e.title, e.area.label.en, e.view.label.en, e.area.label.pl, e.view.label.pl, e.view.path].join(' ')).includes(q));
  }, [entries, query]);

  useEffect(() => { if (open) { setQuery(''); setActive(0); setTimeout(() => input.current?.focus(), 0); } }, [open]);
  useEffect(() => { setActive(0); }, [query]);
  if (!open) return null;

  const go = (e: Entry | undefined) => { if (!e) return; onClose(); navigate(e.view.path); };
  return <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-start justify-center p-4 pt-[10vh]" onClick={onClose}>
    <div role="dialog" aria-modal="true" aria-label={nav.text('search')} data-testid="command-palette"
      className="w-full max-w-lg bg-white rounded-lg shadow-xl border border-slate-200 overflow-hidden" onClick={e => e.stopPropagation()}>
      <input ref={input} value={query} onChange={e => setQuery(e.target.value)} placeholder={nav.text('search_placeholder')}
        data-testid="command-input" aria-label={nav.text('search')}
        className="w-full px-4 py-3 text-sm border-b border-slate-200 outline-none"
        onKeyDown={e => {
          if (e.key === 'Escape') onClose();
          else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, found.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); go(found[active]); }
        }} />
      <ul className="max-h-[60vh] overflow-auto py-1" role="listbox">
        {found.length === 0 && <li className="px-4 py-3 text-sm text-slate-500">{nav.text('no_results')}</li>}
        {found.map((e, i) => <li key={`${e.area.id}/${e.view.id}`} role="option" aria-selected={i === active}>
          <button type="button" data-testid={`command-${e.area.id}-${e.view.id}`} onMouseEnter={() => setActive(i)} onClick={() => go(e)}
            className={`w-full flex items-center gap-3 px-4 py-2 text-left text-sm ${i === active ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700'}`}>
            <AreaIcon name={e.area.icon} className="w-4 h-4 shrink-0 text-slate-400" />
            <span className="flex-1 min-w-0 truncate">{e.title}</span>
            {e.view.advanced && <span className="text-[10px] uppercase tracking-wide text-slate-400">{nav.text('advanced')}</span>}
          </button>
        </li>)}
      </ul>
    </div>
  </div>;
}
