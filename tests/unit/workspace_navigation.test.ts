import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import profileData from '../../config/workspace-navigation.json';
import { capabilitiesFor, CAPABILITIES } from '../../shared/authorization';
import { WorkspaceNavigationSchema, availableWorkspaceGroups, activeWorkspaceGroup } from '../../shared/workspace_navigation';
import { WorkspaceMenu, WorkspaceTabs, WorkspaceUtilities } from '../../src/components/WorkspaceNavigation';
import { SourceCard } from '../../src/pages/Sources';
import type { Source } from '../../src/types';

const profile = WorkspaceNavigationSchema.parse(profileData);
const render = (component: Parameters<typeof createElement>[0], props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, createElement(component, props)));

test('workspace navigation preserves seven coherent groups while capabilities determine available views', () => {
  assert.deepEqual(availableWorkspaceGroups(profile, capabilitiesFor(['developer'])).map(group => group.id),
    ['dashboard', 'data', 'analysis', 'collection', 'projects', 'papers', 'database']);
  const responder = availableWorkspaceGroups(profile, capabilitiesFor(['responder']));
  assert.deepEqual(responder.map(group => group.id), ['dashboard', 'database']);
  assert.deepEqual(responder[1].views.map(view => view.href), ['/search', '/memory', '/responder']);
  const researcher = availableWorkspaceGroups(profile, capabilitiesFor(['researcher']));
  assert.equal(researcher.flatMap(group => group.views).some(view => view.href === '/responder'), false);
  const viewer = availableWorkspaceGroups(profile, capabilitiesFor(['viewer']));
  assert.equal(viewer.find(group => group.id === 'papers')?.views[0].href, '/runs', 'group entry must lead to an available view');
  assert.deepEqual(availableWorkspaceGroups(profile, []).map(group => group.id), ['dashboard']);
});

test('nested existing deep links stay in their workspace and unrelated route prefixes do not match', () => {
  const groups = availableWorkspaceGroups(profile, CAPABILITIES);
  assert.equal(activeWorkspaceGroup(groups, '/runs/fixture-run/results')?.id, 'papers');
  assert.equal(activeWorkspaceGroup(groups, '/source-access')?.id, 'data');
  assert.equal(activeWorkspaceGroup(groups, '/memory')?.id, 'database');
  for (const path of ['/runs-other', '/source-access-other', '/settings/access', '/diagnostics']) {
    assert.equal(activeWorkspaceGroup(groups, path), undefined);
  }
});

test('navigation configuration rejects external paths, duplicate sections, duplicate routes and unknown capabilities', () => {
  for (const href of ['//example.org', 'https://example.org', '/runs?redirect=external', '/../admin']) {
    const candidate = structuredClone(profileData); candidate.groups[1].views[0].href = href;
    assert.equal(WorkspaceNavigationSchema.safeParse(candidate).success, false);
  }
  const repeatedGroup = structuredClone(profileData); repeatedGroup.groups[1].id = 'dashboard';
  assert.equal(WorkspaceNavigationSchema.safeParse(repeatedGroup).success, false);
  const repeatedRoute = structuredClone(profileData); repeatedRoute.groups[1].views[0].href = '/';
  assert.equal(WorkspaceNavigationSchema.safeParse(repeatedRoute).success, false);
  const unknownCapability = structuredClone(profileData); unknownCapability.groups[1].views[0].anyCapability = ['imaginary.permission'];
  assert.equal(WorkspaceNavigationSchema.safeParse(unknownCapability).success, false);
});

test('rendered main navigation separates utility links and marks nested run/results context', () => {
  const props = { capabilities: capabilitiesFor(['developer']), pathname: '/runs/fixture/results' };
  const menu = render(WorkspaceMenu, props);
  assert.equal((menu.match(/data-workspace=/g) ?? []).length, 7);
  assert.match(menu, /aria-current="page" data-workspace="papers"/);
  assert.doesNotMatch(menu, /\/diagnostics|\/settings\/access|\/setup/);
  const tabs = render(WorkspaceTabs, props);
  assert.match(tabs, /<a[^>]*aria-current="page"[^>]*href="\/runs"/);
  assert.match(tabs, /href="\/research"/);
  const responderTabs = render(WorkspaceTabs, { capabilities: capabilitiesFor(['responder']), pathname: '/responder' });
  assert.match(responderTabs, /href="\/memory"/);
  assert.doesNotMatch(responderTabs, /href="\/evidence"/);
  const utility = render(WorkspaceUtilities, { capabilities: capabilitiesFor(['responder']), pathname: '/responder' });
  assert.match(utility, /href="\/setup"/);
  assert.doesNotMatch(utility, /\/diagnostics|\/settings\/access/);
});

test('source cards cannot offer runnable planned or credential-blocked entries, or acquisition to viewers', () => {
  const base: Source = { source_id: 'fixture:test', adapter: 'Fixture', status: 'fixture', capabilities: ['result_count'], description: 'Fictional test source.' };
  for (const status of ['planned', 'blocked', 'blocked-by-license/auth'] as const) {
    const output = renderToStaticMarkup(createElement(SourceCard, { source: { ...base, status }, canAcquire: true, submitting: false, onAcquire: () => {} }));
    assert.match(output, /disabled=""/); assert.match(output, new RegExp(`data-source-status="${status}"`));
  }
  const fixture = renderToStaticMarkup(createElement(SourceCard, { source: base, canAcquire: true, submitting: false, onAcquire: () => {} }));
  assert.match(fixture, /Uruchom źródło testowe/); assert.doesNotMatch(fixture, /disabled=""/);
  const viewer = renderToStaticMarkup(createElement(SourceCard, { source: base, canAcquire: false, submitting: false, onAcquire: () => {} }));
  assert.doesNotMatch(viewer, /<button/);
});
