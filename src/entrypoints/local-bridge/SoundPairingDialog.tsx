import { useEffect, useRef, useState } from 'react';
import Modal from '@components/Modal';
import Text from '@components/Text';
import Container from '@components/Container';
import Button from '@components/Button';
import { t } from '@services/i18n/i18n';
import { startSoundPairing } from '@services/browser/soundPairing';
export default function SoundPairingDialog({ onCode, onError, onClose }: { onCode: (code: string) => void; onError: (key: string) => void; onClose: () => void }) {
  const stop = useRef<(() => void) | null>(null);
  const [listening, setListening] = useState(false);
  useEffect(() => {
    const leave = () => { stop.current?.(); onClose(); };
    const hide = () => { if (document.hidden) leave(); };
    document.addEventListener('visibilitychange', hide); window.addEventListener('pagehide', leave);
    return () => { stop.current?.(); document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', leave); };
  }, [onClose]);
  return <Modal title={t('localBridge.sound')} onClose={onClose} maxWidth={480}>
    <Container gap={4}>
      <Text variant="secondary">{t('localBridge.soundHint')}</Text>
      {listening ? <Text role="status">{t('localBridge.soundListening')}</Text> : <Button onClick={() => { setListening(true); stop.current = startSoundPairing(onCode, onError); }}>{t('localBridge.soundStart')}</Button>}
    </Container>
  </Modal>;
}
