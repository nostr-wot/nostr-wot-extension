import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import IconWarning from '@assets/IconWarning.tsx';
import { ButtonSecondary, ButtonDanger } from '@components/Button';
import CopyButton from '@components/CopyButton';
import useTimedReveal from '@hooks/useTimedReveal.ts';
import Container from '@components/Container';
import StatusNotice from '@components/StatusNotice';
import Text from '@components/Text';

/** State is scoped to this action and discarded when its panel unmounts. */
export default function NsecExportPanel({ onClose }: { onClose: () => void }) {
  const nsec = useTimedReveal<string>('', 30_000);
  const handleClose = () => { nsec.clear(); onClose(); };
  const revealNsec = async () => {
    try {
      const value = await rpc<string>('vault_exportNsec');
      if (value) nsec.reveal(value);
    } catch { /* ignore */ }
  };

  return (
    <Container gap={5}>
      {!nsec.revealed ? (
        <>
          <StatusNotice variant="callout" tone="error" icon={<IconWarning />}>
            {t('key.nsecWarning')}
          </StatusNotice>
          <Container variant="row" gap={4} className="justify-end mt-2">
            <ButtonSecondary small onClick={handleClose}>{t('common.cancel')}</ButtonSecondary>
            <ButtonDanger small onClick={revealNsec}>{t('key.revealKey')}</ButtonDanger>
          </Container>
        </>
      ) : (
        <>
          {/* Reveal is a toggle, and it was a div with an onClick — so
              the only way to see your own nsec required a mouse.
              aria-pressed reports whether it is currently revealed. */}
          <button
            type="button"
            className={`w-full text-left cursor-pointer py-6 bg-card border border-card-border rounded-panel font-[SF_Mono,Cascadia_Code,Fira_Code,monospace] text-xs text-heading break-all leading-loose transition-[filter] duration-slow ${nsec.blurred ? 'blur-[6px] select-none' : ''}`}
            onClick={nsec.toggleBlur}
            aria-pressed={!nsec.blurred}
          >
            {nsec.value}
          </button>
          <Text variant="muted" as="div" className="text-center">{`${t(nsec.blurred ? 'key.clickToReveal' : 'key.clickToBlur')} \u00b7 ${t('key.autoHideHint')}`}</Text>
          <Container variant="row" gap={4} className="justify-end mt-2">
            <ButtonSecondary small onClick={handleClose}>{t('common.close')}</ButtonSecondary>
            <CopyButton value={nsec.value} label={t('common.copy')} />
          </Container>
        </>
      )}
    </Container>
  );
}
