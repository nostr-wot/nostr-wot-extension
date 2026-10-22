import { WizardStep } from '@constants/wizard.ts';
import { useState, useEffect, useRef } from 'react';
import { isLanguageChosen } from '@services/i18n/i18n.ts';
import { rpcRead } from '@services/rpc.ts';
import OverlayPanel from '@components/OverlayPanel';
import TopoBg from '@components/TopoBg';
import useWizardFlow from '@hooks/useWizardFlow';
import { useAnimatedVisible } from '@hooks/useAnimatedVisible.ts';
import WizardSteps from './WizardSteps';
import Button from '@components/Button';
import FormError from '@components/FormError';
import Container from '@components/Container';
import { t } from '@services/i18n/i18n';
import DoneStep from './DoneStep';

interface WizardOverlayProps {
  visible: boolean;
  canClose: boolean;
  /** False while the parent is still loading accounts, so `canClose` is not yet an answer. */
  accountsLoaded?: boolean;
  onClose?: () => void;
  onComplete?: (account: unknown) => void;
}

export default function WizardOverlay({ visible, canClose, accountsLoaded = true, onClose, onComplete }: WizardOverlayProps) {
  // Whether accounts existed when this wizard session began. Creating or restoring
  // the first account updates `canClose` mid-session; following it would swap the
  // steps for the seed check and remount them, aborting and repeating the passkey
  // recovery write or re-running Passkey's autoStart (an extra biometric prompt).
  // Fixed once the answer is known while visible; released when the wizard closes.
  const [hasAccounts, setHasAccounts] = useState(canClose);
  const fixed = useRef(false);
  useEffect(() => {
    if (!visible) { fixed.current = false; setHasAccounts(canClose); return; }
    if (fixed.current) return;
    setHasAccounts(canClose);
    if (accountsLoaded) fixed.current = true;
  }, [visible, canClose, accountsLoaded]);
  const [hasGeneratedAccount, setHasGeneratedAccount] = useState(false);
  const [seedReady, setSeedReady] = useState(false);
  const [seedError, setSeedError] = useState('');
  const [seedAttempt, setSeedAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setSeedReady(false);
    setSeedError('');
    if (visible && hasAccounts) {
      rpcRead<{ hasSeed: boolean }>('onboarding_checkExistingSeed')
        .then(r => {
          if (typeof r?.hasSeed !== 'boolean') throw new Error(t('common.error'));
          if (active) { setHasGeneratedAccount(r.hasSeed); setSeedReady(true); }
        })
        .catch(error => { if (active) setSeedError((error as Error).message); });
    }
    return () => { active = false; };
  }, [visible, hasAccounts, seedAttempt]);

  const flow = useWizardFlow({
    initialStep: WizardStep.Language,
    skipLang: isLanguageChosen(),
    hasAccounts,
    hasGeneratedAccount,
    persist: true,
  });

  const { shouldRender, animating } = useAnimatedVisible(visible);

  const handleClose = () => { flow.reset(); onClose?.(); };
  const handleDone = () => { const acct = flow.account; flow.reset(); onComplete?.(acct); };

  // Finishing goes straight to the main screen; the confirmation floats over it.
  const [finished, setFinished] = useState<{ account: any; derived: boolean } | null>(null);
  useEffect(() => {
    if (flow.step !== WizardStep.Done) return;
    setFinished({ account: flow.account, derived: hasGeneratedAccount && flow.context?.method === 'create' && !flow.mnemonic });
    handleDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per arrival at Done
  }, [flow.step]);
  const notice = finished && <DoneStep account={finished.account} derived={finished.derived} onDone={() => setFinished(null)} />;

  if (!shouldRender || flow.step === WizardStep.Done) return notice || null;

  return (
    <>
    <OverlayPanel showHeader={false} noPadding zIndex={500} animating={animating} className="[background:var(--bg-page)] backdrop-filter-none">
      <TopoBg className="flex flex-col flex-1 min-h-0">
        {hasAccounts && !seedReady ? <Container gap={4} className="p-6"><FormError>{seedError}</FormError><Button disabled={!seedError} onClick={() => setSeedAttempt(value => value + 1)}>{t(seedError ? 'common.retry' : 'common.loading')}</Button><Button variant="secondary" onClick={handleClose}>{t('common.cancel')}</Button></Container> : flow.loading ? null : (
          <WizardSteps
            flow={flow}
            onClose={canClose ? handleClose : null}
            onDone={handleDone}
            onLangSelect={() => flow.send('NEXT')}
            hasAccounts={hasAccounts}
            hasGeneratedAccount={hasGeneratedAccount}
          />
        )}
      </TopoBg>
    </OverlayPanel>
    {notice}
    </>
  );
}
