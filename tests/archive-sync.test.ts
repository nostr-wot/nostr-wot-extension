import { archiveRelayResults, archiveResultStatus } from '../src/domain/archive/results.ts';
import { ARCHIVE_OVERLAP_SECONDS } from '../src/constants/archive.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextArchiveRange } from '../src/domain/archive/checkpoint.ts';
import { validateArchiveSettings, initialArchiveSettings, archiveRelayUrl } from '../src/domain/archive/settings.ts';
import { syncArchivePage } from '../src/services/archive/pagination.ts';
import type { SignedEvent } from '../src/domain/nostr/types.ts';
const base = () => nextArchiveRange(undefined, 'wss://example.com/', 'authored', 100000);
const event = (created_at: number) => ({created_at}) as SignedEvent;
test('archive settings validate destinations and selected scope', () => {
 const s=initialArchiveSettings(['wss://example.com','wss://example.com/']);
 assert.equal(s.groups[0].relays.length,1);
 assert.equal(validateArchiveSettings(s).automatic,false);
 assert.throws(()=>archiveRelayUrl('https://example.com'));
 assert.throws(()=>archiveRelayUrl('wss://user:password@example.com'));
 assert.throws(()=>archiveRelayUrl('ws://example.com'));
 assert.throws(()=>validateArchiveSettings({...s,automatic:true,groups:[]}));
 assert.throws(()=>validateArchiveSettings({...s,intervalMinutes:1}));
});
test('checkpoint resumes fixed boundaries and overlaps incremental runs',()=>{
 const previous={...base(),until:1000000,complete:true,checkedAt:1000000000,fullCheckedAt:1000000000};
 const range=nextArchiveRange(previous,previous.relay,previous.stream,1000060000);
 assert.equal(range.since,1000000-ARCHIVE_OVERLAP_SECONDS);
 assert.equal(nextArchiveRange({...range,nextUntil:800000},range.relay,range.stream,1000070000).until,range.until);
 assert.equal(nextArchiveRange(previous,previous.relay,previous.stream,2000000000).since,0);
});
test('pagination keeps boundary second inclusive, commits before coverage advances',async()=>{
 let saved;
 const next=await syncArchivePage(base(),{authors:['a']},{query:async f=>{assert.equal(f.until,100);return {events:[event(80),event(70)],received:500,status:'eose'};},commit:async(_,cp)=>{saved=cp;}});
 assert.equal(next.nextUntil,70);assert.equal(next.complete,false);assert.equal(saved,next);
});
test('timeout saves valid events without claiming completion',async()=>{
 let saved;
 await assert.rejects(syncArchivePage(base(),{}, {query:async()=>({events:[event(90)],received:1,status:'timeout'}),commit:async(_,cp)=>{saved=cp;}}),/timeout/);
 assert.equal(saved!.complete,false);assert.equal(saved!.checkedAt,0);
});
test('saturated single-second pages are retried at higher limits and never silently skipped',async()=>{
 const limits:number[]=[];
 await assert.rejects(syncArchivePage(base(),{}, {query:async f=>{limits.push(f.limit!);return {events:[event(100)],received:f.limit!,status:'eose'};},commit:async()=>{}}),/incomplete/);
 assert.deepEqual(limits,[500,1000,2000,4000]);
});
test('transaction failure and cancellation do not advance a checkpoint',async()=>{
 await assert.rejects(syncArchivePage(base(),{}, {query:async()=>({events:[],received:0,status:'eose'}),commit:async()=>{throw new Error('quota');}}),/quota/);
 const controller=new AbortController();controller.abort();let queried=false;
 await assert.rejects(syncArchivePage(base(),{}, {query:async()=>{queried=true;throw new Error();},commit:async()=>{}},controller.signal));assert.equal(queried,false);
});

test('every configured frequency validates and the default is hourly', () => {
  assert.equal(initialArchiveSettings().intervalMinutes, 60);
  for (const intervalMinutes of [60, 1440, 10080]) {
    assert.equal(validateArchiveSettings({ ...initialArchiveSettings(), intervalMinutes }).intervalMinutes, intervalMinutes);
  }
  for (const intervalMinutes of [0, 59, 61, 1441, NaN, Infinity, '60']) {
    assert.throws(() => validateArchiveSettings({ ...initialArchiveSettings(), intervalMinutes }));
  }
});


test('relay summary counts success only when all streams complete', () => {
  const checkpoints = ['authored', 'messages', 'legacyMessages'].flatMap(stream => [
    { key: `a|${stream}`, relay: 'wss://a.test/', stream, complete: true, since: 0, until: 1, checkedAt: 1 },
    { key: `b|${stream}`, relay: 'wss://b.test/', stream, complete: false, since: 0, until: 1, checkedAt: 0, error: 'timeout' },
  ]) as import('../src/domain/archive/types.ts').ArchiveCheckpoint[];
  const results = archiveRelayResults(['wss://a.test/', 'wss://b.test/', 'wss://c.test/'], true, checkpoints);
  assert.deepEqual(results.map(result => result.success), [true, false, false]);
  assert.deepEqual(results[1].errors, ['timeout']);
});

test('archive statuses distinguish no attempt, error, incomplete coverage and success', () => {
  const result = { relay: 'wss://relay.test', success: false, errors: [], attempted: false };
  assert.equal(archiveResultStatus([result]), 'notSynced');
  assert.equal(archiveResultStatus([{ ...result, attempted: true }]), 'incomplete');
  const failure = { ...result, attempted: true, errors: ['timeout'], fetched: 0 };
  assert.equal(archiveResultStatus([failure]), 'error');
  assert.equal(archiveResultStatus([{ ...failure, fetched: 2 }]), 'incomplete');
  assert.equal(archiveResultStatus([failure, { ...result, success: true, attempted: true }]), 'incomplete');
  assert.equal(archiveResultStatus([{ ...result, success: true, attempted: true }]), 'complete');
});
