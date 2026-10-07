import { ARCHIVE_EXPLORER_PAGE_SIZE } from '@constants/archive';
import { useEffect, useRef, useState } from 'react';
import type { ArchiveExplorerItem, ArchiveExplorerFilter } from '@domain/archive/explorer';
import { rpcRead } from '@services/rpc';

/** Count the entire filtered archive, but retain only the displayed page in memory. */
export default function useArchiveExplorer(accountId: string, filter: ArchiveExplorerFilter, revision: number, total = 0) {
  const [records, setRecords] = useState<ArchiveExplorerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanned, setScanned] = useState(0);
  const [matching, setMatching] = useState(0);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const generation = useRef(0);
  const filterKey = JSON.stringify(filter);
  useEffect(() => { setPage(0); }, [accountId, filterKey, revision, total]);
  useEffect(() => {
    const token = ++generation.current;
    let stopped = false;
    const current = () => !stopped && token === generation.current;
    setRecords([]); setScanned(0); setMatching(0); setLoading(true); setError('');
    const timer = setTimeout(() => { void (async () => {
      let after: string | undefined;
      let count = 0;
      const visible: ArchiveExplorerItem[] = [];
      const offset = page * ARCHIVE_EXPLORER_PAGE_SIZE;
      try {
        do {
          const result = await rpcRead<{ records: ArchiveExplorerItem[]; next?: string; scanned: number }>('archive_explore', { accountId, filter: JSON.parse(filterKey), after });
          if (!current()) return;
          for (const record of result.records) {
            if (count >= offset && visible.length < ARCHIVE_EXPLORER_PAGE_SIZE) visible.push(record);
            count++;
          }
          after = result.next;
          setScanned(previous => previous + result.scanned);
          setMatching(count);
          setRecords([...visible]);
        } while (after);
      } catch (e) { if (current()) setError((e as Error).message); }
      finally { if (current()) setLoading(false); }
    })(); }, 200);
    return () => { stopped = true; clearTimeout(timer); };
  }, [accountId, filterKey, revision, total, page]);
  return { records, loading, scanned, matching, error, page,
    previousPage: () => setPage(value => Math.max(0, value - 1)),
    nextPage: () => setPage(value => value + 1),
    more: (page + 1) * ARCHIVE_EXPLORER_PAGE_SIZE < matching };
}
