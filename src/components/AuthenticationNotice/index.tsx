import type { AuthenticationRequest } from '@domain/signing/authentication.ts';
import Container from '@components/Container';
import FieldDisplay from '@components/FieldDisplay';
import Text from '@components/Text';
import StatusNotice from '@components/StatusNotice';
import { t } from '@services/i18n/i18n.ts';
import clients from '../../data/auth-clients.json';

export default function AuthenticationNotice({request}:{request:{origin?:string;pubkey?:string;authentication?:AuthenticationRequest}}) {
  const auth=request.authentication;
  if(!auth) return null;
  const known=clients.find(client=>client.origins.includes(request.origin || '') && client.backends.some(backend=>backend.origin===auth.destination && backend.auth===auth.protocol));
  return <Container gap={3} className="min-w-0 break-all">
    <FieldDisplay label={t('auth.requester')} value={request.origin || '?'} />
    <FieldDisplay label={t('auth.destination')} value={auth.destination} mono />
    <FieldDisplay label={t('auth.resource')} value={`${auth.method ? `${auth.method} ` : ''}${auth.url}`} mono />
    <FieldDisplay label={t('auth.account')} value={request.pubkey || '?'} mono />
    {known && <Text variant="hint">{t('auth.knownBackend',{name:known.name})}</Text>}
    <StatusNotice tone="warn" icon={null} variant="callout">{t(auth.protocol==='nip42' ? 'auth.relayNotice' : auth.crossOrigin ? 'auth.crossOrigin' : 'auth.identityNotice')}</StatusNotice>
  </Container>;
}
