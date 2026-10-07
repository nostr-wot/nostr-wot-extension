import { ARCHIVE_EXPLORER_PAGE_SIZE } from '@constants/archive';
import { useEffect, useRef, useState } from 'react';
import type { ArchiveExplorerItem } from '@domain/archive/explorer';
import type { ArchiveExplorerFilter } from '@domain/archive/explorer';
import { rpc } from '@services/rpc';

/** Scan one page at a time; stale requests never repopulate a changed or closed view. */
export default function useArchiveExplorer(accountId: string, filter: ArchiveExplorerFilter, revision: number) {
  const [records, setRecords] = useState<ArchiveExplorerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanned, setScanned] = useState(0);
  const [error, setError] = useState('');
  const [more, setMore] = useState(false);
  const [page, setPage] = useState(0);
  const cursor = useRef<string | undefined>(undefined);
  const generation = useRef(0);
  const filterKey = JSON.stringify(filter);
  useEffect(() => { generation.current++; cursor.current = undefined; setRecords([]); setScanned(0); setPage(0); }, [accountId, filterKey, revision]);
  useEffect(() => {
    const token = ++generation.current;
    let stopped = false;
    const current = () => !stopped && token === generation.current;
    setLoading(true); setError(''); setMore(false);
    const timer = setTimeout(() => { void (async () => {
      let matches = 0;
      try {
        do {
          const result = await rpc<{ records: ArchiveExplorerItem[]; next?: string; scanned: number }>('archive_explore', { accountId, filter: JSON.parse(filterKey), after: cursor.current });
          if (!current()) return;
          cursor.current = result.next;
          matches += result.records.length;
          setScanned(count => count + result.scanned);
          setRecords(previous => [...new Map([...previous, ...result.records].map(record => [record.event.id, record])).values()]);
        } while (cursor.current && matches < ARCHIVE_EXPLORER_PAGE_SIZE);
        if (current()) setMore(!!cursor.current);
      } catch (e) { if (current()) setError((e as Error).message); }
      finally { if (current()) setLoading(false); }
    })(); }, 200);
    return () => { stopped = true; clearTimeout(timer); };
  }, [accountId, filterKey, revision, page]);
  return { records, loading, scanned, error, more, loadMore: () => setPage(value => value + 1) };
}
