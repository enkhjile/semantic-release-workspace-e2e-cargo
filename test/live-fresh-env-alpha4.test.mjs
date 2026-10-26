import assert from 'node:assert/strict';
import test from 'node:test';
import {
  freshCloneCredentialBoundary,
  freshCloneEnvironment,
} from '../support/fresh-clone-env-alpha4.mjs';

test('fresh-clone retry retains GitHub Git transport while removing publishing and OIDC credentials', () => {
  const env = freshCloneEnvironment(
    {
      CI: 'true',
      GITHUB_ACTION: 'run',
      GITHUB_ACTIONS: 'true',
      GITHUB_REPOSITORY: 'enkhjile/semantic-release-workspace-e2e-cargo',
      GITHUB_TOKEN: 'repository-transport-token',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-request-token',
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://actions.example/oidc',
      CARGO_REGISTRY_TOKEN: 'cargo-token',
      CARGO_REGISTRIES_CRATES_IO_TOKEN: 'crates-token',
      NODE_AUTH_TOKEN: 'npm-token',
      NPM_TOKEN: 'npm-token',
      PATH: '/usr/bin',
    },
    {
      cargoHome: '/tmp/fresh-cargo-home',
      npmUserconfig: '/tmp/fresh.npmrc',
    },
  );

  assert.deepEqual(freshCloneCredentialBoundary(env), {
    identityNames: [],
    publishingCredentialNames: [],
    repositoryTransportNames: ['GITHUB_ACTION', 'GITHUB_TOKEN'],
  });
  assert.deepEqual(
    Object.keys(env).filter(
      (key) => key.startsWith('GITHUB_') && !['GITHUB_ACTION', 'GITHUB_TOKEN'].includes(key),
    ),
    [],
  );
  assert.equal(env.CI, 'true');
  assert.equal(env.CARGO_HOME, '/tmp/fresh-cargo-home');
  assert.equal(env.npm_config_userconfig, '/tmp/fresh.npmrc');
});
