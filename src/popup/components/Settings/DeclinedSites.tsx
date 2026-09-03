import React, { useState, useEffect, useCallback } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import Card from '@components/Card/Card';
import Button from '@components/Button/Button';
import Dropdown from '@components/Dropdown/Dropdown';
import { SectionLabel } from '@components/SectionLabel/SectionLabel';
import styles from './Settings.module.css';

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
    <div className={styles.declinedBlock}>
      <SectionLabel>{t('perm.declinedTitle')}</SectionLabel>
      <p className={styles.declinedDesc}>{t('perm.declinedDesc')}</p>

      <label className={styles.declinedDurationRow}>
        <span>{t('perm.dismissDurationLabel')}</span>
        <select
          className={styles.declinedSelect}
          value={duration}
          onChange={(e) => changeDuration(Number(e.target.value))}
        >
          {DURATIONS.map(([ms, label]) => <option key={ms} value={ms}>{label}</option>)}
        </select>
      </label>

      {declined.length === 0 ? (
        <p className={styles.declinedDesc}>{t('perm.declinedNone')}</p>
      ) : (
        <div className={styles.permsList}>
          {declined.map(({ domain, until }) => (
            <div key={domain} className={styles.declinedRow}>
              <div className={styles.permInfo}>
                <div className={styles.permDomain}>{domain}</div>
                <div className={styles.permSummary}>{describe(until)}</div>
              </div>
              <button className={styles.declinedRemove} onClick={() => undo(domain)}>
                {t('perm.declinedRemove')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
