import { useState, useEffect, useRef, useCallback, ChangeEvent } from 'react';
import { rpc } from '@services/rpc.ts';
import useCopy from '@hooks/useCopy.ts';
import { t } from '@lib/i18n.js';
import Input from '@components/Input/Input';
import Button from '@components/Button/Button';
import QrCode from '@components/QrCode/QrCode';
import Spinner from '@components/Spinner/Spinner';
import Tabs from '@components/Tabs/Tabs';
import FormError from '@components/FormError/FormError';
import Heading from '@components/Heading/Heading';
import { SectionLabel } from '@components/SectionLabel/SectionLabel';

function isValidBunkerUrl(url: string): boolean {
  if (!url.startsWith('bunker://')) return false;
  try {
    const stripped = url.replace('bunker://', 'https://');
    const parsed = new URL(stripped);
    const pk = parsed.hostname || parsed.pathname.replace(/^\//, '');
    return /^[0-9a-f]{64}$/i.test(pk);
  } catch { return false; }
}

const POLL_INTERVAL = 2500;

type QrState = 'idle' | 'generating' | 'waiting' | 'connected' | 'expired' | 'error';

interface Nip46StepProps {
  onNext: (account: any) => void;
}

export default function Nip46Step({ onNext }: Nip46StepProps) {
  const [tab, setTab] = useState<'qr' | 'bunker'>('qr');

  // QR tab state
  const [qrState, setQrState] = useState<QrState>('idle');
  const [nostrconnectUri, setNostrconnectUri] = useState<string>('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const uriCopy = useCopy();
  const [errorMsg, setErrorMsg] = useState<string>('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionRef = useRef<string | null>(null);

  // Bunker tab state
  const [input, setInput] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  // Start QR session on mount
  const startQrSession = useCallback(async () => {
    setQrState('generating');
    setNostrconnectUri('');
    setSessionId(null);
    setErrorMsg('');
    try {
      const result = await rpc<{ nostrconnectUri: string; sessionId: string }>('onboarding_initNostrConnect', {});
      setNostrconnectUri(result.nostrconnectUri);
      setSessionId(result.sessionId);
      sessionRef.current = result.sessionId;
      setQrState('waiting');
    } catch {
      setQrState('expired');
    }
  }, []);

  useEffect(() => {
    if (tab === 'qr' && qrState === 'idle') {
      void startQrSession();
    }
  }, [tab, qrState, startQrSession]);

  // Poll for connection
  useEffect(() => {
    if (qrState !== 'waiting' || !sessionId) return;

    pollRef.current = setInterval(async () => {
      try {
        const result = await rpc<{ connected?: boolean; expired?: boolean; error?: string; account?: any }>('onboarding_pollNostrConnect', { sessionId });
        if (result.connected) {
          clearInterval(pollRef.current!);
          setQrState('connected');
          onNext(result.account);
        } else if (result.error) {
          clearInterval(pollRef.current!);
          setErrorMsg(result.error);
          setQrState('error');
        } else if (result.expired) {
          clearInterval(pollRef.current!);
          setQrState('expired');
        }
      } catch {
        clearInterval(pollRef.current!);
        setQrState('expired');
      }
    }, POLL_INTERVAL);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [qrState, sessionId, onNext]);

  // Cleanup on unmount: ONLY stop polling. Do NOT cancel the NostrConnect
  // session here — the popup unmounts/blurs when the user switches to their
  // wallet app to scan the QR, and cancelling would tear down the live signer
  // mid-scan. The session is persisted (storage.session) and resumed by
  // onboarding_initNostrConnect on the next mount. Cancellation is only an
  // explicit user action (Retry).
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleRetry = () => {
    // Explicitly tear down the failed/expired session before starting fresh.
    if (sessionRef.current) {
      rpc('onboarding_cancelNostrConnect', { sessionId: sessionRef.current }).catch(() => {});
      sessionRef.current = null;
    }
    setErrorMsg('');
    setQrState('idle');
  };

  // Bunker URL handler
  const handleBunkerContinue = async () => {
    const val = input.trim();
    if (!val) { setError(t('wizard.enterBunkerUrl')); return; }
    if (!isValidBunkerUrl(val)) { setError(t('wizard.invalidBunkerUrl')); return; }

    setLoading(true);
    setError('');

    try {
      const result = await rpc<{ account: any }>('onboarding_connectNip46', { bunkerUrl: val });
      onNext(result.account);
    } catch (e: any) {
      setError(e.message || t('wizard.connectionFailed'));
    }
    setLoading(false);
  };

  return (
    <div className="flex flex-col flex-1">
      <Heading className="mb-3">{t('wizard.nip46Title')}</Heading>
      <p className="text-md text-secondary leading-normal mb-8">{t('wizard.nip46Desc')}</p>

      <Tabs
        variant="segmented"
        label={t('wizard.nip46Title')}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'qr', label: t('wizard.nip46QrTab') },
          { value: 'bunker', label: t('wizard.nip46BunkerTab') },
        ]}
      />

      {/* QR tab */}
      {tab === 'qr' && (
        <div className="flex flex-col items-center gap-6">
          {(qrState === 'waiting' || qrState === 'generating') && (
            <>
              <div className="flex items-center justify-center p-8 bg-elevated border border-card-border rounded-[14px] shadow-[0_2px_12px_var(--card-bg)]">
                {nostrconnectUri ? (
                  <QrCode value={nostrconnectUri} size={180} className="text-[#1a1a2e]" />
                ) : (
                  <div className="w-[180px] h-[180px] flex items-center justify-center">
                    <Spinner size={32} />
                  </div>
                )}
              </div>
              <p className="text-xs text-muted text-center leading-normal max-w-[240px]">{t('wizard.nip46QrHint')}</p>
              {nostrconnectUri && (
                <button
                  className="inline-flex items-center gap-2 py-[5px] px-6 border border-card-border bg-card rounded-sm text-xs font-medium font-[inherit] text-secondary cursor-pointer transition-all hover:border-brand hover:text-brand"
                  onClick={() => uriCopy.copy(nostrconnectUri)}
                >
                  {uriCopy.copied ? t('wizard.nip46UriCopied') : t('wizard.nip46CopyUri')}
                </button>
              )}
              <div className="flex items-center gap-4 text-sm text-secondary py-2">
                <Spinner size={14} border={2} />
                <span>{t('wizard.nip46Waiting')}</span>
              </div>
            </>
          )}

          {qrState === 'connected' && (
            <div className="flex items-center gap-4 text-sm text-secondary py-2">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="8" fill="#16a34a"/>
                <path d="M5 8l2 2 4-4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>{t('wizard.nip46Connected')}</span>
            </div>
          )}

          {qrState === 'expired' && (
            <div className="flex flex-col items-center gap-6 py-10">
              <p className="text-md text-muted">{t('wizard.nip46Expired')}</p>
              <Button onClick={handleRetry}>{t('wizard.nip46Retry')}</Button>
            </div>
          )}

          {qrState === 'error' && (
            <div className="flex flex-col items-center gap-6 py-10">
              <p className="text-md text-error text-center leading-normal max-w-[240px] break-words">{errorMsg || t('wizard.nip46Error')}</p>
              <Button onClick={handleRetry}>{t('wizard.nip46Retry')}</Button>
            </div>
          )}
        </div>
      )}

      {/* Bunker URL tab */}
      {tab === 'bunker' && (
        <div>
          <div className="mb-6">
            <SectionLabel>{t('wizard.bunkerLabel')}</SectionLabel>
            <Input
              mono
              placeholder={t('wizard.bunkerPlaceholder')}
              value={input}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { setInput(e.target.value); setError(''); }}
            />
            <div className="text-xs text-muted mt-2">
              {t('wizard.bunkerHint')}
            </div>
          </div>

          <FormError>{error}</FormError>

          <div className="flex gap-4 mt-auto py-8 sticky bottom-0 z-[1] [background:var(--bg-page)]">
            <Button className="flex-1" onClick={handleBunkerContinue} disabled={!input.trim() || loading}>
              {loading ? t('wizard.connecting') : t('common.connect')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
