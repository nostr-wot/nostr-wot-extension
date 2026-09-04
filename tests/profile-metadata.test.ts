/**
 * The kind:0 read-modify-write behind Edit Profile.
 *
 * Publishing replaces the whole event, so this merge is the only thing standing
 * between a user's profile and the fields it silently loses. It had no test.
 *
 * Run with:
 *   node --import tsx --test tests/profile-metadata.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeProfileMetadata,
  profileHasChanges,
  type ProfileFields,
  type ProfileMetadata,
} from '../src/domain/profile/profileMetadata.ts';

const fields = (over: Partial<ProfileFields> = {}): ProfileFields => ({
  name: '', about: '', picture: '', nip05: '', lud16: '', website: '', banner: '',
  ...over,
});

describe('mergeProfileMetadata — preserving what we do not own', () => {
  it('keeps fields this form has never heard of', () => {
    // A kind:0 accumulates keys from every client the user has ever used.
    // Publishing replaces the event, so dropping one deletes it for good.
    const existing: ProfileMetadata = {
      name: 'ada',
      lud06: 'lnurl1...',
      nip05_verified_at: 1234,
      pronouns: 'she/her',
    };
    const out = mergeProfileMetadata(existing, fields({ name: 'ada' }));
    assert.equal(out.lud06, 'lnurl1...');
    assert.equal(out.nip05_verified_at, 1234);
    assert.equal(out.pronouns, 'she/her');
  });

  it('deletes a cleared field rather than publishing an empty string', () => {
    // `"nip05": ""` is a claim, not an absence — clients try to verify it and
    // then show it as failing.
    const out = mergeProfileMetadata({ name: 'ada', nip05: 'ada@example.com' }, fields({ name: 'ada' }));
    assert.equal('nip05' in out, false);
    assert.notEqual(out.nip05, '');
  });

  it('writes the fields the user filled in', () => {
    const out = mergeProfileMetadata(null, fields({ name: 'ada', about: 'hi', website: 'https://e.com' }));
    assert.deepEqual(out, { name: 'ada', about: 'hi', website: 'https://e.com', display_name: 'ada' });
  });
});

describe('mergeProfileMetadata — display_name mirrors name', () => {
  it('sets display_name alongside name', () => {
    const out = mergeProfileMetadata(null, fields({ name: 'ada' }));
    assert.equal(out.display_name, 'ada');
  });

  it('CLEARS display_name when the name is cleared', () => {
    // The regression this pins: display_name was set but never deleted, so
    // emptying the name field deleted `name` and left the old value in
    // `display_name` — the field many clients prefer. The user watched the name
    // disappear from the form, published, and the old name kept showing.
    const out = mergeProfileMetadata({ name: 'ada', display_name: 'ada' }, fields({ name: '' }));
    assert.equal('name' in out, false);
    assert.equal('display_name' in out, false, 'a cleared name must not survive as display_name');
  });
});

describe('mergeProfileMetadata — picture precedence', () => {
  it('a freshly uploaded picture beats the typed URL', () => {
    const out = mergeProfileMetadata(null, fields({ picture: 'https://old.example/a.png' }), 'https://new.example/b.png');
    assert.equal(out.picture, 'https://new.example/b.png');
  });

  it('falls back to the typed URL when nothing was uploaded', () => {
    const out = mergeProfileMetadata(null, fields({ picture: 'https://typed.example/a.png' }), null);
    assert.equal(out.picture, 'https://typed.example/a.png');
  });

  it('deletes the picture when both are empty', () => {
    const out = mergeProfileMetadata({ picture: 'https://old.example/a.png' }, fields(), null);
    assert.equal('picture' in out, false);
  });
});

describe('profileHasChanges', () => {
  const existing: ProfileMetadata = { name: 'ada', about: 'hi', nip05: 'ada@e.com' };
  const matching = fields({ name: 'ada', about: 'hi', nip05: 'ada@e.com' });

  it('is false when the form matches what is published', () => {
    assert.equal(profileHasChanges(existing, matching), false);
  });

  it('is true for an edit to any owned field', () => {
    assert.equal(profileHasChanges(existing, { ...matching, about: 'hello' }), true);
    assert.equal(profileHasChanges(existing, { ...matching, banner: 'https://e.com/b.png' }), true);
  });

  it('is true when a field was cleared', () => {
    assert.equal(profileHasChanges(existing, { ...matching, nip05: '' }), true);
  });

  it('is true whenever a new image was picked, whatever the fields say', () => {
    assert.equal(profileHasChanges(existing, matching, true), true);
  });

  it('treats a published display_name as the name the form started from', () => {
    assert.equal(profileHasChanges({ display_name: 'ada' }, fields({ name: 'ada' })), false);
    assert.equal(profileHasChanges({ display_name: 'ada' }, fields({ name: 'bob' })), true);
  });
});
