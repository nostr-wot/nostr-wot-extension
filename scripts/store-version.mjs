import assert from 'node:assert/strict';
export function compareVersions(a, b) {
  assert.match(a, /^\d+\.\d+\.\d+$/, 'Unsupported store version');
  assert.match(b, /^\d+\.\d+\.\d+$/);
  const x = a.split('.').map(BigInt), y = b.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

