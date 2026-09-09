import { useState, useEffect } from 'react';
import browser from '@lib/browser.ts';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import { formatPermissionLabel } from '@services/i18n/permissionLabels.ts';
import { formatSats } from '@domain/wallet/display.ts';
import Button from '@components/Button/Button';
import EventPreview from '@components/EventPreview/EventPreview';
import DecisionRow from './DecisionRow';
import UnlockSection from './UnlockSection';
import type { PromptDecision } from '@domain/permissions/prompt.ts';
import Container from '@components/Container/Container';

interface PendingPrompt {
  pubkey?: string;
  origin?: string;
  type?: string;
  event?: any;
  theirPubkey?: string;
  vaultLocked?: boolean;
  needsPermission?: boolean;
  walletAmount?: number;
}

export default function PromptScreen() {
  const [prompt, setPrompt] = useState<PendingPrompt | null>(null);
  const [vaultLocked, setVaultLocked] = useState<boolean>(false);
  const [buttonsDisabled, setButtonsDisabled] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    browser.storage.session.get(['pendingPrompt']).then((data: any) => {
      if (data.pendingPrompt) {
        setPrompt(data.pendingPrompt);
        setVaultLocked(data.pendingPrompt.vaultLocked || false);
      } else {
        setError(t('prompt.noPendingRequest'));
      }
      setLoading(false);
    }).catch(() => {
      setError(t('prompt.failedLoad'));
      setLoading(false);
    });
  }, []);

  const sendDecision = async (decision: PromptDecision) => {
    setButtonsDisabled(true);
    try {
      await rpc('prompt_decision', { decision });
      window.close();
    } catch {
      setButtonsDisabled(false);
    }
  };

  const handleDecision = async (decision: PromptDecision) => {
    if (vaultLocked && decision.allow) {
      return;
    }
    void sendDecision(decision);
  };

  const handleUnlocked = () => {
    setVaultLocked(false);
  };

  if (loading) {
    return (
      <Container gap={6} className="min-h-screen p-8 font-sans">
        <div className="text-center py-10 text-muted">{t('common.loading')}</div>
      </Container>
    );
  }
  if (error) {
    return (
      <Container gap={6} className="min-h-screen p-8 font-sans">
        <div className="text-center py-10 text-error">{error}</div>
      </Container>
    );
  }
  if (!prompt) return null;

  const needsPermission = prompt.needsPermission !== false;

  return (
    <Container gap={6} className="min-h-screen p-8 font-sans">
      <div className="text-center">
        <div className="inline-flex items-center gap-4 py-3 px-7 bg-card border border-brand-light rounded-md">
          <span className="text-sm font-mono text-muted">
            {prompt.pubkey?.slice(0, 8)}...{prompt.pubkey?.slice(-8)}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between py-5 px-7 bg-brand-tint-hover border border-brand-tint-active rounded-md">
        <span className="text-sm uppercase tracking-[0.5px] text-muted">{t('prompt.from')}</span>
        <span className="text-lg font-semibold text-heading">{prompt.origin}</span>
      </div>

      {prompt.type?.startsWith('webln_') ? (
        <>
          <div className="text-center text-3xl font-bold text-brand">
            {prompt.type === 'webln_sendPayment' ? 'Lightning Payment' : 'Lightning Request'}
          </div>
          {prompt.walletAmount !== undefined && prompt.walletAmount > 0 && (
            <div className="text-center text-display font-heavy text-heading py-6">
              {formatSats(prompt.walletAmount)}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="text-center text-3xl font-bold text-brand">
            {formatPermissionLabel(prompt.type || '')}
          </div>

          <EventPreview
            type={prompt.type || null}
            event={prompt.event}
            theirPubkey={prompt.theirPubkey}
            className="flex-1"
          />
        </>
      )}

      {vaultLocked && (
        <UnlockSection onUnlocked={handleUnlocked} />
      )}

      {needsPermission ? (
        <DecisionRow
          disabled={buttonsDisabled || vaultLocked}
          onDecision={handleDecision}
        />
      ) : (
        <Container variant="row" gap={3} className="flex-wrap">
          <Button
            variant="secondary"
            disabled={buttonsDisabled}
            onClick={() => sendDecision({ allow: false, remember: false })}
          >
            {t('common.cancel')}
          </Button>
          <Button
            disabled={buttonsDisabled || vaultLocked}
            onClick={() => sendDecision({ allow: true, remember: false })}
          >
            {vaultLocked ? t('prompt.unlockFirst') : t('common.continue')}
          </Button>
        </Container>
      )}
    </Container>
  );
}
