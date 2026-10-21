import StatusNotice from '@components/StatusNotice';
import IconInfo from '@assets/IconInfo';
import TopoBg from '@components/TopoBg';
import Card from '@components/Card';
import AnimatedWotLogo from '@components/AnimatedWotLogo';
import { version } from '../../../package.json';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import browser from '@lib/browser.ts';
import { randomBytes } from '@lib/crypto/utils.ts';
import { rpc, rpcRead } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import { attachBridgeTab } from '@services/browser/localBridgeTab.ts';
import { LocalBridgeClient } from '@services/signing/localBridge/client';
import { parsePairingUri } from '@services/signing/localBridge/protocol';
import { createWifiTransport, createBleTransport } from '@services/signing/localBridge/transports';
import Button, { ButtonSecondary, ButtonDanger } from '@components/Button';
import ActionTile from '@components/ActionTile';
import Container from '@components/Container';
import Heading from '@components/Heading';
import Text from '@components/Text';
import Input from '@components/Input';
import IconGlobe from '@assets/IconGlobe';
import IconLink from '@assets/IconLink';
import IconCamera from '@assets/IconCamera';
import IconMicrophone from '@assets/IconMicrophone';
import IconChevronLeft from '@assets/IconChevronLeft';
import IconButton from '@components/IconButton';

const QrCameraDialog = lazy(() => import('./QrCameraDialog'));
const SoundPairingDialog = lazy(() => import('./SoundPairingDialog'));

type Mode = 'wifi' | 'ble';
export default function LocalBridgeApp() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [uri, setUri] = useState('');
  const [scanning, setScanning] = useState(false);
  const [hearing, setHearing] = useState(false);
  const closeSound = useCallback(() => setHearing(false), []);
  const soundError = useCallback((key: string) => { setHearing(false); setError(t(key)); }, []);
  const closeScanner = useCallback(() => setScanning(false), []);
  const scanError = useCallback((key: string) => { setScanning(false); setError(t(key)); }, []);
  const [state, setState] = useState<'idle' | 'choose-device' | 'connecting' | 'connected'>('idle');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(false);
  const [pubkey, setPubkey] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const cleanup = useRef<(() => void) | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    let live = true;
    void rpcRead<{ selected: boolean }>('localBridgeStatus').then((status) => { if (live) setSelected(status.selected); }).catch((e: Error) => { if (live) setError(e.message); });
    const close = () => { generation.current++; cleanup.current?.(); cleanup.current = null; };
    window.addEventListener('pagehide', close);
    return () => { live = false; window.removeEventListener('pagehide', close); close(); };
  }, []);

  const disconnect = () => { generation.current++; cleanup.current?.(); cleanup.current = null; setState('idle'); setConfirmation(''); };
  const connect = useCallback(async (value: string) => {
    const attempt = ++generation.current;
    setError(''); setConfirmation('');
    let key: Uint8Array | undefined;
    try {
      const offer = mode === 'ble' ? null : parsePairingUri(value);
      if (offer && offer.transport !== mode) throw new Error(t('localBridge.wrongTransport'));
      key = randomBytes(32);
      setState('connecting');
      let client: LocalBridgeClient | undefined;
      const addresses = mode === 'ble' ? [''] : offer!.addresses;
      for (const address of addresses) {
        const transport = mode === 'ble' ? createBleTransport() : createWifiTransport(address);
        cleanup.current = () => transport.close();
        let compared = false;
        try {
          // BLE device selection must start directly from this click's user activation.
          const options = { secretKey: key, transport, onConfirmation: (code: string) => { compared = true; if (attempt === generation.current) setConfirmation(code); } };
          client = mode === 'ble' ? await LocalBridgeClient.connectBluetooth(options) : await LocalBridgeClient.connect({ ...options, offer: offer! });
          break;
        } catch (e) {
          transport.close();
          if (compared || attempt !== generation.current || address === addresses[addresses.length - 1]) throw e;
        }
      }
      if (!client) throw new Error(t('localBridge.failed'));
      if (attempt !== generation.current) { client.close(); return; }
      cleanup.current = () => client.close();
      const identity = await client.request('get_public_key', []);
      if (!/^[0-9a-f]{64}$/.test(identity)) throw new Error(t('localBridge.failed'));
      if (attempt !== generation.current) { client.close(); return; }
      const port = browser.runtime.connect({ name: 'local-bridge' });
      const connection = attachBridgeTab(client, port, identity, (reason) => {
        if (generation.current === attempt) { setState('idle'); setError(reason); }
      });
      cleanup.current = connection.close;
      await connection.ready;
      if (attempt !== generation.current) { connection.close(); return; }
      setConfirmation(''); setPubkey(identity); setUri(''); setSelected(true); setState('connected');
    } catch (e) {
      if (attempt !== generation.current) return;
      cleanup.current?.(); cleanup.current = null;
      setConfirmation(''); setState('idle'); setError(e instanceof Error ? e.message : t('localBridge.failed'));
    } finally { key?.fill(0); }
  }, [mode]);
  const scanned = useCallback((value: string) => {
    setScanning(false); setHearing(false);
    try {
      const offer = parsePairingUri(value);
      if (offer.transport !== mode) throw new Error(t('localBridge.wrongTransport'));
      setUri(value.trim()); setError('');
      if (mode === 'ble') setState('choose-device');
      else void connect(value.trim());
    } catch (e) { setError(e instanceof Error ? e.message : t('localBridge.invalidQr')); }
  }, [mode, connect]);
  const disable = async () => {
    setError('');
    try { await rpc('localBridgeDisable'); disconnect(); setSelected(false); }
    catch (e) { setError(e instanceof Error ? e.message : t('localBridge.failed')); }
  };
  const bluetoothAvailable = 'bluetooth' in navigator;
  return <TopoBg className="min-h-screen flex flex-col text-heading">
    <header className="w-full max-w-[1120px] mx-auto px-8 py-7 sm:px-12">
      <Container variant="row" gap={4} className="items-center">
        <span aria-hidden="true" className="text-brand"><AnimatedWotLogo size={40} /></span>
        <Text className="font-semibold text-lg">Nostr WoT</Text>
      </Container>
    </header>
    <main className="flex-1 flex items-center justify-center px-6 py-8 sm:px-12">
    <div className="w-full max-w-[540px]">
    <Card data-testid="bridge-card" className="w-full mb-0 p-8 sm:p-12">
    <Container gap={6}>
      {mode && <Button variant="neutral" small className="self-start" onClick={() => { disconnect(); setMode(null); setUri(''); setError(''); }}><IconChevronLeft />{t('common.back')}</Button>}
      <Heading>{t('localBridge.title')}</Heading>
      <Text variant="secondary">{t('localBridge.intro')}</Text>
      {!mode ? <>
        <ActionTile icon={<IconGlobe />} title={t('localBridge.wifi')} description={t('localBridge.wifiHint')} onClick={() => setMode('wifi')} />
        <ActionTile icon={<IconLink />} title={t('localBridge.ble')} description={t(bluetoothAvailable ? 'localBridge.bleHint' : 'localBridge.unsupported')} disabled={!bluetoothAvailable} onClick={() => setMode('ble')} />
      </> : <>
        <Heading level={2}>{t(mode === 'ble' ? 'localBridge.ble' : 'localBridge.wifi')}</Heading>
        <Text>{t(mode === 'ble' ? 'localBridge.bleInstructions' : 'localBridge.instructions')}</Text>
        <Text variant="hint">{t('localBridge.accountHint')}</Text>
        {state === 'idle' && mode === 'wifi' && <Input type="password" label={t('localBridge.code')} value={uri} onChange={(event) => setUri(event.target.value)} onPaste={(event) => { event.preventDefault(); scanned(event.clipboardData.getData('text')); }} onKeyDown={(event) => { if (event.key === 'Enter' && uri.trim()) { event.preventDefault(); scanned(uri); } }} autoComplete="off" spellCheck={false} actions={[
          <IconButton key="camera" size="large" title={t('localBridge.scan')} aria-label={t('localBridge.scan')} onClick={() => { setError(''); setScanning(true); }}><IconCamera /></IconButton>,
          <IconButton key="sound" size="large" title={t('localBridge.sound')} aria-label={t('localBridge.sound')} onClick={() => { setError(''); setHearing(true); }}><IconMicrophone /></IconButton>,
        ]} />}
        {state === 'connected' ? <>
          <Text className="text-success" role="status">{t('localBridge.connected')}</Text>
          <Text mono className="break-all">{pubkey}</Text>
          <StatusNotice tone="warn" icon={<IconInfo />} label={t('localBridge.keepOpenTitle')} variant="callout">{t('localBridge.keepOpenHint')}</StatusNotice>
        </> : (state === 'choose-device' || (mode === 'ble' && state === 'idle')) ? <Button onClick={() => void connect(uri)}>{t('localBridge.choosePhone')}</Button> : state === 'connecting' ? <Text role="status">{t('localBridge.connecting')}</Text> : null}
        {state === 'connecting' && confirmation && <Card><Text variant="secondary">{t('localBridge.confirmHint')}</Text><Text mono className="text-3xl text-center font-bold tracking-widest">{confirmation.slice(0, 3)} {confirmation.slice(3)}</Text></Card>}
        {state === 'connecting' && <ButtonSecondary onClick={disconnect}>{t('common.cancel')}</ButtonSecondary>}
      </>}
      <Text variant="hint">{t('localBridge.sessionHint')}</Text>
      {selected && <Container gap={2}><ButtonDanger onClick={() => void disable()}>{t('localBridge.disconnect')}</ButtonDanger><Text variant="hint">{t('localBridge.disconnectHint')}</Text></Container>}
      {error && <Text className="text-error" role="alert">{error}</Text>}
    </Container>
    </Card>
    </div>
    </main>
    {scanning && <Suspense fallback={null}><QrCameraDialog onCode={scanned} onError={scanError} onClose={closeScanner} /></Suspense>}
    {hearing && <Suspense fallback={null}><SoundPairingDialog onCode={scanned} onError={soundError} onClose={closeSound} /></Suspense>}
    <footer className="px-8 py-7 text-center">
      <Text variant="hint">Nostr WoT · v{version}</Text>
    </footer>
  </TopoBg>;
}
