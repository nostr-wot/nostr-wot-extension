import type { AuthenticationRequest } from '@domain/signing/authentication.ts';
import Container from '@components/Container';
import FieldDisplay from '@components/FieldDisplay';
import Text from '@components/Text';
import StatusNotice from '@components/StatusNotice';
import { t } from '@services/i18n/i18n.ts';
import clients from '../../data/auth-clients.json';

export default function AuthenticationNotice({ request }: {
  request: { origin?: string; pubkey?: string; authentication?: AuthenticationRequest };
}) {
  const auth = request.authentication;
  if (!auth) return null;
  const relay = auth.protocol === 'nip42';
  const url = new URL(auth.url);
  // Keep non-default ports and distinct relay endpoints visible without repeating
  // the same URL in several labelled rows. HTTP review retains the exact signed URL.
  const destination = relay
    ? `${url.host}${url.pathname === '/' ? '' : url.pathname}${url.search}`
    : auth.url;
  const known = clients.find(client => client.origins.includes(request.origin || '') &&
    client.backends.some(backend => backend.origin === auth.destination && backend.auth === auth.protocol));

  return <Container gap={3} className="min-w-0">
    <Text className="[overflow-wrap:anywhere]">
      {t(relay ? 'auth.relaySummary' : 'auth.httpSummary')}{' '}
      <Text as="strong" mono>{destination}</Text>.
    </Text>
    {auth.method && <FieldDisplay label={t('auth.methods')} value={auth.method} mono />}
    {known && <Text variant="hint">{t('auth.knownBackend', { name: known.name })}</Text>}
    {!relay && auth.crossOrigin && <StatusNotice tone="warn" icon={null} variant="callout">
      {t('auth.crossOrigin')}
    </StatusNotice>}
  </Container>;
}
