import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import raw from '../../config/ui/navigation.json';
import { NavigationSchema, landingPaths, locate, visibleNavigation } from '../../shared/navigation';
import { capabilitiesFor } from '../../shared/authorization';

/**
 * Spec 14 / D21: the navigation is a projection over the existing routes. No
 * page may drop out of it, and it may not point anywhere that is not a page.
 */
const nav = NavigationSchema.parse(raw);
const app = fs.readFileSync('src/App.tsx', 'utf8');
const layoutChrome = new Set(['login', 'join', 'apply', '*']);
const routed = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map(m => m[1])
  .filter(p => !layoutChrome.has(p) && p !== '/')
  .map(p => `/${p}`);
const sample = (p: string) => p.replace(/:[a-z]+/g, 'x');
const views = [...nav.areas, nav.settings].flatMap(a => a.views.map(v => ({ area: a.id, ...v })));

test('navigation: every routed page belongs to exactly one view', () => {
  assert.ok(routed.length >= 15, `routes were found in App.tsx: ${routed.join(', ')}`);
  for (const path of ['/', ...routed]) {
    const concrete = sample(path);
    const hit = locate(nav, concrete);
    assert.ok(hit?.view, `${path} has a place in the navigation`);
    const owners = views.filter(v => concrete === v.path || (!v.exact && ((v.match ?? []).some(m => concrete.startsWith(m)) || (v.path !== '/' && concrete.startsWith(`${v.path}/`)))));
    assert.ok(owners.length >= 1, `${path} is owned by a view`);
  }
  assert.equal(locate(nav, '/runs/x/results')?.view?.id, 'runs', 'run detail pages stay in Run history');
  assert.equal(locate(nav, '/settings')?.view?.id, 'setup');
});

test('navigation: every view points at a real route and view ids are unique', () => {
  const real = new Set(['/', ...routed]);
  for (const v of views) assert.ok(real.has(v.path), `${v.area}/${v.id} → ${v.path} is routed in App.tsx`);
  const ids = views.map(v => `${v.area}/${v.id}`);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(nav.areas.map(a => a.id)).size, nav.areas.length);
});

test('navigation: area landing paths do not shadow a page and are generated in App.tsx', () => {
  const real = new Set(routed);
  for (const { path } of landingPaths(nav)) assert.ok(!real.has(path), `${path} is not also a page`);
  assert.match(app, /landingPaths\(NAVIGATION\)/);
  assert.deepEqual(landingPaths(nav).map(l => l.path).sort(), ['/analysis', '/data', '/knowledge', '/projects']);
});

test('navigation: seven areas plus settings, labelled in both languages, icons bundled', () => {
  assert.equal(nav.areas.length, 7);
  const bundled = /AREA_ICONS = \{([^}]+)\}/.exec(fs.readFileSync('src/lib/navigation.tsx', 'utf8'))![1].split(',').map(s => s.trim());
  for (const a of [...nav.areas, nav.settings]) assert.ok(bundled.includes(a.icon), `${a.icon} is in AREA_ICONS`);
  assert.equal(NavigationSchema.safeParse({ ...raw, strings: { ...raw.strings, en: { search: 'x' } } }).success, false);
});

test('navigation: capability filtering follows the role bundles', () => {
  const ids = (roles: string[]) => {
    const v = visibleNavigation(nav, capabilitiesFor(roles));
    return { areas: v.areas.map(a => a.id), settings: v.settings?.views.map(x => x.id) ?? [] };
  };
  const responder = ids(['responder']);
  assert.ok(responder.areas.includes('knowledge'));
  assert.ok(!responder.areas.includes('analysis'), 'a responder does not see the analysis area');
  assert.ok(!responder.settings.includes('people'));
  const dev = ids(['developer']);
  assert.deepEqual(dev.areas, nav.areas.map(a => a.id), 'a developer sees every area');
  assert.ok(dev.settings.includes('people'));
  assert.ok(!ids(['researcher']).settings.includes('people'));
});
