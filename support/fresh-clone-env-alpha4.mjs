const repositoryTransportNames = ['GITHUB_ACTION', 'GITHUB_TOKEN'];
const repositoryTransport = new Set(repositoryTransportNames);

const isCredentialOrIdentity = (name) =>
  /TOKEN|SECRET|PASSWORD|ACTIONS_ID|GITLAB|CIRCLE|SIGSTORE/.test(name);

export function freshCloneEnvironment(source, { cargoHome, npmUserconfig }) {
  const env = {
    ...source,
    CI: 'true',
    CARGO_HOME: cargoHome,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    npm_config_userconfig: npmUserconfig,
  };

  for (const name of Object.keys(env)) {
    if (
      !repositoryTransport.has(name) &&
      (/^GITHUB_/.test(name) || isCredentialOrIdentity(name))
    ) {
      delete env[name];
    }
  }

  return env;
}

export function freshCloneCredentialBoundary(env) {
  const names = Object.keys(env).sort();
  return {
    identityNames: names.filter((name) =>
      /ACTIONS_ID|CRATES_IO_ID_TOKEN|GITHUB_ACTIONS|GITLAB_CI|NPM_ID_TOKEN|SIGSTORE_ID_TOKEN/.test(
        name,
      ),
    ),
    publishingCredentialNames: names.filter((name) =>
      /^(CARGO_.*TOKEN|NPM_TOKEN|NODE_AUTH_TOKEN)$/.test(name),
    ),
    repositoryTransportNames: repositoryTransportNames.filter((name) => env[name]),
  };
}
