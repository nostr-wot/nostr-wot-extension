import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

interface Backend {
  origin: string;
  purpose: string;
  auth: 'nip98' | 'other' | 'unverified';
  sources: string[];
}
interface Client {
  id: string;
  name: string;
  origins: string[];
  backends: Backend[];
  sources: string[];
  checkedAt: string;
  notes?: string;
}
const clients: Client[] = JSON.parse(readFileSync(
  new URL('../src/data/auth-clients.json', import.meta.url), 'utf8',
));

function assertOrigin(value: string) {
  const url = new URL(value);
  assert.equal(url.protocol, 'https:');
  assert.equal(value, url.origin, `Expected exact canonical origin: ${value}`);
  assert.ok(!value.includes('*'), 'Wildcards are not origins');
}
function assertSources(sources: string[]) {
  assert.ok(Array.isArray(sources) && sources.length > 0, 'Evidence is required');
  assert.equal(new Set(sources).size, sources.length);
  for (const source of sources) {
    const url = new URL(source);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.username, '');
    assert.equal(url.password, '');
  }
}

describe('informational auth client registry', () => {
  it('keeps stable unique IDs, sorted records and unambiguous client origins', () => {
    assert.ok(Array.isArray(clients) && clients.length >= 20);
    assert.equal(new Set(clients.map(client => client.id)).size, clients.length);
    assert.deepEqual(clients.map(client => client.id), clients.map(client => client.id).sort());
    const origins = new Set<string>();
    for (const client of clients) {
      assert.match(client.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      assert.ok(typeof client.name === 'string' && client.name.trim().length > 0);
      assert.ok(Array.isArray(client.origins) && client.origins.length > 0);
      for (const origin of client.origins) {
        assertOrigin(origin);
        assert.ok(!origins.has(origin), `Duplicate client origin: ${origin}`);
        origins.add(origin);
      }
    }
  });

  it('requires dated source evidence and explicitly documents unknown backends', () => {
    for (const client of clients) {
      assertSources(client.sources);
      assert.match(client.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
      const date = new Date(`${client.checkedAt}T00:00:00Z`);
      assert.equal(date.toISOString().slice(0, 10), client.checkedAt);
      assert.ok(date.getTime() <= Date.now(), 'Review date cannot be in the future');
      assert.ok(Array.isArray(client.backends));
      if (client.backends.length === 0) {
        assert.ok(client.notes && /unverified|not been verified|not verified/i.test(client.notes));
      }
    }
  });

  it('requires exact, unique backend origins and explicit auth evidence per relationship', () => {
    for (const client of clients) {
      const origins = new Set<string>();
      for (const backend of client.backends) {
        assertOrigin(backend.origin);
        assert.ok(!origins.has(backend.origin), `Duplicate backend for ${client.id}`);
        origins.add(backend.origin);
        assert.ok(['nip98', 'other', 'unverified'].includes(backend.auth));
        assert.ok(typeof backend.purpose === 'string' && backend.purpose.trim().length > 0);
        assertSources(backend.sources);
        for (const source of backend.sources) {
          if (source.startsWith('https://github.com/') && source.includes('/blob/')) {
            assert.match(source, /\/blob\/[a-f0-9]{40}\//, 'Backend evidence must use an immutable commit');
          }
        }
      }
    }
  });

  it('contains descriptive fields only, with no permission or autoapproval flags', () => {
    for (const client of clients) {
      for (const key of Object.keys(client)) {
        assert.ok(['id', 'name', 'origins', 'backends', 'sources', 'checkedAt', 'notes'].includes(key));
      }
      for (const backend of client.backends) {
        assert.deepEqual(Object.keys(backend).sort(), ['auth', 'origin', 'purpose', 'sources']);
      }
    }
  });
});
