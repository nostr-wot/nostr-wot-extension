import { useEffect, useRef } from 'react';
import Modal from '@components/Modal';
import Text from '@components/Text';
import Container from '@components/Container';
import { t } from '@services/i18n/i18n';
import { startQrCamera } from '@services/browser/qrCamera';

export default function QrCameraDialog({ onCode, onError, onClose }: { onCode: (code: string) => void; onError: (key: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!video.current) return;
    const stop = startQrCamera(video.current, onCode, onError);
    const hide = () => { if (document.hidden) { stop(); onClose(); } };
    const leave = () => { stop(); onClose(); };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', leave);
    return () => { stop(); document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', leave); };
  }, [onCode, onError, onClose]);
  return <Modal title={t('localBridge.scan')} onClose={onClose} maxWidth={480}>
    <Container gap={4}>
      <Text variant="secondary">{t('localBridge.scanHint')}</Text>
      <video ref={video} autoPlay muted playsInline aria-label={t('localBridge.scan')} className="w-full aspect-[4/3] rounded-lg bg-input object-cover" />
    </Container>
  </Modal>;
}
