import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can, RBAC } from '../../shared/authorization';
import policy from '../../config/access/policy.json';

test('credential.store: off for viewer by the shipped access policy, on for every role above viewer that runs research', () => {
  assert.equal(policy.credentials.viewerMayStore, false);
  assert.equal(can(['viewer'], 'credential.store'), false);
  for (const role of ['researcher', 'admin', 'access_admin', 'developer'] as const) assert.equal(can([role], 'credential.store'), true, role);
  assert.ok(RBAC.viewer.includes('provider.view'), 'a viewer still sees which keys exist');
});
