import {test} from 'node:test';
import assert from 'node:assert/strict';
import data from '../../config/workspace-preferences.json';
import {workspaceBase,workspacePreferences,resolveWorkspace,WorkspacePreferencesSchema} from '../../shared/workspace_preferences';
import {availableWorkspaceGroups,activeWorkspaceGroup} from '../../shared/workspace_navigation';
import {ROLES,capabilitiesFor} from '../../shared/authorization';

test('E7.7: every language and preset preserves all authorized routes and the main grouping default',()=>{
  for(const role of ROLES) {
    const capabilities=capabilitiesFor([role]);
    const expected=availableWorkspaceGroups(workspaceBase,capabilities).flatMap(g=>g.views.map(v=>v.href)).sort();
    for(const preset of Object.keys(workspacePreferences.presets)) for(const lang of ['pl','en'] as const) {
      const nav=resolveWorkspace(preset,lang);
      assert.deepEqual(availableWorkspaceGroups(nav,capabilities).flatMap(g=>g.views.map(v=>v.href)).sort(),expected);
    }
  }
  assert.equal(activeWorkspaceGroup(resolveWorkspace('main','pl').groups,'/runs/example/results')?.id,'papers');
  assert.equal(activeWorkspaceGroup(resolveWorkspace('claude','en').groups,'/runs/example/results')?.id,'analysis');
  assert.equal(activeWorkspaceGroup(resolveWorkspace('claude','en').groups,'/projects')?.id,'projects');
  assert.equal(activeWorkspaceGroup(resolveWorkspace('claude','en').groups,'/search')?.id,'database');
});
test('E7.7: incompatible or incomplete presets fail instead of hiding work',()=>{
  const missing=structuredClone(data);missing.presets.claude.groups.projects.routes=[];
  assert.equal(WorkspacePreferencesSchema.safeParse(missing).success,false);
  const duplicate=structuredClone(data);duplicate.presets.claude.groups.analysis.routes.push('/projects');
  assert.equal(WorkspacePreferencesSchema.safeParse(duplicate).success,false);
  const collision=structuredClone(data);Object.assign(collision.landings,{'/projects':'projects'});
  assert.equal(WorkspacePreferencesSchema.safeParse(collision).success,false);
  const absent=structuredClone(data);delete (absent.views as Record<string,unknown>)['/search'];
  assert.equal(WorkspacePreferencesSchema.safeParse(absent).success,false);
});
