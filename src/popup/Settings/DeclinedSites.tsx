import React, { useState, useEffect, useCallback } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import Card from '@components/Card/Card';
import Button from '@components/Button/Button';
import Dropdown from '@components/Dropdown/Dropdown';
import { SectionLabel } from '@components/SectionLabel/SectionLabel';
import styles from './Settings.module.css';
import LinkButton from '@components/LinkButton/LinkButton';

/**
 * Sites the user declined to connect, and how long that lasts.
 *
 * "Not now" used to be permanent and invisible: nothing listed it, and the only way out was
 * discovering that connecting cleared it. A decision the user cannot see is one they cannot
 * revisit, so every dismissal appears here — including the explicit "Never" — with a way to
 * undo it.
 */
export default function DeclinedSites() {
  const [declined, setDeclined] = useState<Array<{ domain: string; until: number | 'session' | 'never' }>>([]);
  const [duration, setDuration] = useState<number>(604_800_000);

  const load = useCallback(async () => {
    const [list, ms] = await Promise.all([
      rpc<Array<{ domain: string; until: number | 'session' | 'never' }>>('getDismissedDomains'),
      rpc<number>('getDismissDuration'),
    ]);
    setDeclined(list || []);
    setDuration(typeof ms === 'number' ? ms : 604_800_000);
  }, []);

  useEffect(() => { load(); }, [load]);

  const changeDuration = async (ms: number) => {
    setDuration(ms);
    await rpc('setDismissDuration', { ms });
  };

  const undo = async (domain: string) => {
    await rpc('removeDismissedDomain', { domain });
    load();
  };

  const describe = (until: number | 'session' | 'never'): string =>
    until === 'never' ? t('perm.declinedNever')
      : until === 'session' ? t('perm.declinedSession')
      : t('perm.declinedUntil', { date: new Date(until).toLocaleDateString() });

  const DURATIONS: Array<[number, string]> = [
    [0, t('perm.duration.session')],
    [86_400_000, t('perm.duration.day')],
    [604_800_000, t('perm.duration.week')],
    [2_592_000_000, t('perm.duration.month')],
  ];

  return (
    <div className="mt-11">
      <SectionLabel>{t('perm.declinedTitle')}</SectionLabel>
      <p className="mt-3 mb-5 text-xs leading-loose text-muted">{t('perm.declinedDesc')}</p>

      <label className="flex items-center justify-between gap-5 mb-6 text-sm text-body">
        <span>{t('perm.dismissDurationLabel')}</span>
        <select
          className="shrink-0 py-2.5 px-4 border border-card-border rounded-sm bg-input text-body text-sm"
          value={duration}
          onChange={(e) => changeDuration(Number(e.target.value))}
        >
          {DURATIONS.map(([ms, label]) => <option key={ms} value={ms}>{label}</option>)}
        </select>
      </label>

      {declined.length === 0 ? (
        <p className="mt-3 mb-5 text-xs leading-loose text-muted">{t('perm.declinedNone')}</p>
      ) : (
        <div className="flex flex-col flex-1 overflow-y-auto overflow-x-hidden border border-card-border bg-glass rounded-panel shadow-[0_2px_12px_var(--brand-tint-active)]">
          {declined.map(({ domain, until }) => (
            <div key={domain} className="flex items-center gap-5 py-5 px-6 border-t border-card-border first:border-t-0">
              <div className={styles.permInfo}>
                <div className={styles.permDomain}>{domain}</div>
                <div className={styles.permSummary}>{describe(until)}</div>
              </div>
              <LinkButton tone="brand" className={`${styles.declinedRemove} shrink-0 underline underline-offset-2 hover:opacity-85`} onClick={() => undo(domain)}>
                {t('perm.declinedRemove')}
              </LinkButton>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
