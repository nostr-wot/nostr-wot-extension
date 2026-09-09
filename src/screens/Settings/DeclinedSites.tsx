import { useState, useEffect, useCallback } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import { SectionLabel } from '@components/SectionLabel/SectionLabel';
import LinkButton from '@components/LinkButton/LinkButton';
import Container from '@components/Container/Container';
import Text from '@components/Text/Text';

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

  useEffect(() => { void load(); }, [load]);

  const changeDuration = async (ms: number) => {
    setDuration(ms);
    await rpc('setDismissDuration', { ms });
  };

  const undo = async (domain: string) => {
    await rpc('removeDismissedDomain', { domain });
    void load();
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
      <Text variant="hint" className="mt-3 mb-5">{t('perm.declinedDesc')}</Text>

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
        <Text variant="hint" as="p" className="mt-3 mb-5">{t('perm.declinedNone')}</Text>
      ) : (
        <Container className="flex-1 overflow-y-auto overflow-x-hidden border border-card-border bg-glass rounded-panel shadow-[0_2px_12px_var(--brand-tint-active)]">
          {declined.map(({ domain, until }) => (
            <Container key={domain} variant="row" gap={5} className="py-5 px-6 border-t border-card-border first:border-t-0">
              {/* These three were `styles.permInfo/permDomain/permSummary`,
                  which stopped existing when the permissions rows became
                  ListRow — leaving this list with no layout at all and nothing
                  to say so. */}
              <div className="flex-1 min-w-0">
                <div className="text-md font-medium text-heading truncate">{domain}</div>
                <Text variant="muted" as="div">{describe(until)}</Text>
              </div>
              <LinkButton tone="brand" className={`text-sm shrink-0 underline underline-offset-2 hover:opacity-85`} onClick={() => undo(domain)}>
                {t('perm.declinedRemove')}
              </LinkButton>
            </Container>
          ))}
        </Container>
      )}
    </div>
  );
}
