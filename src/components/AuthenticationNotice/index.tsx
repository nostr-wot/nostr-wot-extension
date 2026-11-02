import type { AuthenticationRequest } from '@domain/signing/authentication.ts';
import IconWarning from '@assets/IconWarning';
import Container from '@components/Container';
import FieldDisplay from '@components/FieldDisplay';
import Text from '@components/Text';
import StatusNotice from '@components/StatusNotice';
import { t } from '@services/i18n/i18n.ts';
import { findKnownAuthenticationBackend } from '@domain/signing/authentication';

type AuthenticationNoticeRequest = { origin?: string; pubkey?: string; authentication?: AuthenticationRequest };

export function relayLabel(value: string) {
  const url = new URL(value);
  return `${url.host}${url.pathname === '/' ? '' : url.pathname}${url.search}`;
}

export default function AuthenticationNotice({ request, requests }: {
  request: AuthenticationNoticeRequest;
  requests?: AuthenticationNoticeRequest[];
}) {
  if (requests && requests.length > 1) {
    if (requests.every(item => item.authentication?.protocol === 'nip42')) {
      const destinations = [...new Set(requests.map(item => item.authentication!.url))];
      return <Container gap={3} className="min-w-0">
        <Text variant="secondary">{t('auth.relaysSummary')}</Text>
        <ul className="m-0 pl-8 space-y-2 text-brand">
          {destinations.map(url => <li key={url}><Text as="strong" mono className="text-brand [overflow-wrap:anywhere]">{relayLabel(url)}</Text></li>)}
        </ul>
      </Container>;
    }
    return <Container gap={3}>{requests.map((item, index) => <AuthenticationNotice key={index} request={item}/>)}</Container>;
  }
  const auth = request.authentication;
  if (!auth) return null;
  if (auth.protocol === 'legacy-login') return <StatusNotice tone="error" icon={<IconWarning/>} variant="callout" label={t('auth.legacyTitle')}>
    {t('auth.legacyWarning')}
    <p className="mt-3">{t('auth.legacyContact')}</p>
  </StatusNotice>;
  const relay = auth.protocol === 'nip42';
  // Keep non-default ports and distinct relay endpoints visible without repeating
  // the same URL in several labelled rows. HTTP review retains the exact signed URL.
  const destination = relay
    ? relayLabel(auth.url)
    : auth.url;
  const known = findKnownAuthenticationBackend(request.origin || '', auth);

  return <Container gap={3} className="min-w-0">
    <Text variant="secondary" className="[overflow-wrap:anywhere]">
      {t(relay ? 'auth.relaySummary' : 'auth.httpSummary')}{' '}
      <Text as="strong" mono className="text-brand">{destination}</Text>.
    </Text>
    {auth.method && <FieldDisplay label={t('auth.methods')} value={auth.method} mono />}
    {known && <Text variant="hint">{t('auth.knownBackend', { name: known.name })}</Text>}
    {!relay && auth.crossOrigin && <StatusNotice tone="warn" icon={null} variant="callout">
      {t('auth.crossOrigin')}
    </StatusNotice>}
  </Container>;
}
