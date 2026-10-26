// Acceptance transport only: keep the product's canonical registry destination
// while serving its HTTP requests from the same loopback registry Cargo mirrors.
import assert from 'node:assert/strict';
const destination = new URL(process.env.CARGO_TEST_DEFAULT_MIRROR);
assert.equal(destination.hostname, '127.0.0.1');
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const original = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (original.origin === 'https://index.crates.io') {
    return nativeFetch(new URL('/cargo/index' + original.pathname + original.search, destination), options);
  }
  if (original.origin === 'https://crates.io') {
    return nativeFetch(new URL('/cargo' + original.pathname + original.search, destination), options);
  }
  return nativeFetch(input, options);
};
