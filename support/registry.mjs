import {execFileSync, fork} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

// All credentials created here are deliberately synthetic and loopback-scoped.
export async function startRegistry({tls = false} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'srw-consumer-registry-'));
  if (tls) {
    const openssl = (...args) => execFileSync('openssl', args, {cwd: root, stdio: 'ignore'});
    openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.crt', '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-addext', 'basicConstraints=critical,CA:TRUE');
    openssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'client.key', '-out', 'client.csr', '-subj', '/CN=fixture-client');
    openssl('x509', '-req', '-in', 'client.csr', '-CA', 'server.crt', '-CAkey', 'server.key', '-CAcreateserial', '-out', 'client.crt', '-days', '1');
  }
  const server = fork(fileURLToPath(new URL('./registry-server.mjs', import.meta.url)), [root, ...(tls ? ['tls'] : [])], {execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc']});
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {server.kill(); reject(new Error('Registry did not start'));}, 10000);
    server.once('message', message => {clearTimeout(timer); resolve(String(message));});
    server.once('error', error => {clearTimeout(timer); reject(error);});
    server.once('exit', code => {clearTimeout(timer); reject(new Error(`Registry exited ${code}`));});
  });
  const npmrc = join(root, 'npmrc');
  const origin = `//127.0.0.1:${new URL(url).port}/`;
  writeFileSync(npmrc, `${origin}:_authToken=fixture-token\nfetch-retries=0\n${tls ? `cafile=${join(root, 'server.crt')}\n${origin}:certfile=${join(root, 'client.crt')}\n${origin}:keyfile=${join(root, 'client.key')}\n` : ''}`);
  return {
    url, root,
    env: {
      npm_config_userconfig: npmrc,
      npm_config_fetch_retries: '0',
      CARGO_HOME: join(root, 'cargo-home'),
      RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(homedir(), '.rustup'),
      CARGO_REGISTRIES_FIXTURE_TOKEN: 'fixture-token',
      CARGO_NET_RETRY: '0',
    },
    state: () => JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8')),
    control: value => writeFileSync(join(root, 'control'), value),
    trusted: (value = {}) => writeFileSync(join(root, 'oidc.json'), JSON.stringify(value)),
    cargoTrusted: (value = {}) => writeFileSync(join(root, 'cargo-oidc.json'), JSON.stringify(value)),
    async close() {
      if (server.exitCode !== null) return;
      const exited = once(server, 'exit');
      server.kill();
      await exited;
    },
  };
}
