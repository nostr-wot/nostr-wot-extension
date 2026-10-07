import { WizardStep } from '@constants/wizard.ts';
import React from 'react';
import { t } from '@services/i18n/i18n.ts';
import IconChevronLeft from '@assets/IconChevronLeft.tsx';
import IconClose from '@assets/IconClose.tsx';
import IconButton from '@components/IconButton';
import Container from '@components/Container';
import LangStep from './LangStep';
import MethodStep from './MethodStep';
import ImportStep from './ImportStep';
import NpubStep from './NpubStep';
import Nip46Step from './Nip46Step';
import PasskeyStep, { PasskeyBackupStep } from './PasskeyStep';
import CreateStep from './CreateStep';
import SubAccountStep from './SubAccountStep';
import VerifyStep from './VerifyStep';
import PasswordStep from './PasswordStep';
import BackupStep from './BackupStep';
import FollowSuggestionsStep from './FollowSuggestionsStep';
import PermissionCopyStep from './PermissionCopyStep';
import DoneStep from './DoneStep';

interface WizardFlow {
  step: WizardStep;
  context?: { method: string | null };
  account: unknown;
  mnemonic: string | null;
  upgradeId: string | null;
  send: (type: string, payload?: Record<string, unknown>) => void;
  goBack: () => void;
  showBack: boolean;
  reset: () => void;
}

interface StepConfig {
  noHeader?: boolean;
  title?: string;
  content: React.ReactNode;
}

function buildSteps(
  flow: WizardFlow,
  onLangSelect: ((code: string) => void) | null,
  onDone: () => void,
  { hasAccounts, hasGeneratedAccount }: { hasAccounts?: boolean; hasGeneratedAccount?: boolean } = {},
): Record<WizardStep, StepConfig> {
  return {
    [WizardStep.Language]: {
      noHeader: true,
      content: onLangSelect ? <LangStep onSelect={onLangSelect} /> : null,
    },
    [WizardStep.Welcome]: {
      noHeader: true,
      content: null, // welcome screen handled externally by OnboardingApp
    },
    [WizardStep.Method]: {
      title: hasAccounts ? t('wizard.addAccount') : t('wizard.getStarted'),
      content: <MethodStep onSelect={(m: string) => flow.send('SELECT', { method: m })} hasGeneratedAccount={hasGeneratedAccount} hasAccounts={hasAccounts} onMoreOptions={() => flow.send('MORE_OPTIONS')} />,
    },
    [WizardStep.MoreOptions]: {
      title: t('wizard.moreOptions'),
      content: <MethodStep moreOptions onSelect={(method) => flow.send('SELECT', { method })} hasAccounts={hasAccounts} />,
    },
    [WizardStep.Import]: {
      title: t('wizard.importKey'),
      content: <ImportStep onNext={(acct: any, upId: string | null) => flow.send('IMPORTED', { account: acct, upgradeId: upId })} hasGeneratedAccount={hasGeneratedAccount} />,
    },
    [WizardStep.WatchOnly]: {
      title: t('wizard.watchOnly'),
      content: <NpubStep onNext={(acct: any) => flow.send('DONE', { account: acct })} />,
    },
    [WizardStep.NostrConnect]: {
      title: t('wizard.nostrConnect'),
      content: <Nip46Step onNext={(acct: any) => flow.send('DONE', { account: acct })} />,
    },
    [WizardStep.Passkey]: {
      title: t('passkey.create'),
      content: <PasskeyStep onNext={(account) => flow.send('CREATED', { account })} />,
    },
    [WizardStep.PasskeyRestore]: {
      title: t('passkey.restore'),
      content: <PasskeyStep restore onNext={(account) => flow.send('DONE', { account })} />,
    },
    [WizardStep.PasskeyBackup]: {
      title: t('passkey.backup'),
      content: <PasskeyBackupStep onNext={() => flow.send('DONE')} />,
    },
    [WizardStep.Create]: {
      title: t('wizard.createIdentity'),
      content: <CreateStep onNext={(acct: any, seed: string) => flow.send('CREATED', { account: acct, mnemonic: seed })} />,
    },
    [WizardStep.Subaccount]: {
      title: t('wizard.subAccountTitle'),
      content: <SubAccountStep onNext={(acct: any) => flow.send('CREATED', { account: acct })} />,
    },
    [WizardStep.Backup]: {
      title: t('wizard.backUpKeys'),
      content: <BackupStep mnemonic={flow.mnemonic} onNext={() => flow.send('DONE')} />,
    },
    [WizardStep.Verify]: {
      title: t('wizard.verifyBackup'),
      content: <VerifyStep mnemonic={flow.mnemonic} onVerified={() => flow.send('VERIFIED')} />,
    },
    [WizardStep.Password]: {
      title: t('wizard.setPassword'),
      content: (
        <PasswordStep
          account={flow.account}
          upgradeId={flow.upgradeId}
          onNext={(upgraded: boolean) => flow.send('SET', { upgraded })}
        />
      ),
    },
    [WizardStep.FollowSuggestions]: {
      title: t('wizard.followSuggestions'),
      content: <FollowSuggestionsStep onNext={() => flow.send('DONE')} />,
    },
    [WizardStep.PermissionCopy]: {
      title: t('wizard.copyPermissions'),
      content: <PermissionCopyStep account={flow.account as any} onNext={() => flow.send('DONE')} />,
    },
    [WizardStep.Done]: {
      title: t('wizard.allSet'),
      content: <DoneStep account={flow.account as any} derived={hasGeneratedAccount && flow.context?.method === 'create' && !flow.mnemonic} onDone={onDone} />,
    },
  };
}

interface WizardStepsProps {
  flow: WizardFlow;
  onClose: (() => void) | null;
  onDone: () => void;
  onLangSelect: (code: string) => void;
  bodyClassName?: string;
  hasAccounts?: boolean;
  hasGeneratedAccount?: boolean;
}

export default function WizardSteps({ flow, onClose, onDone, onLangSelect, bodyClassName, hasAccounts, hasGeneratedAccount }: WizardStepsProps) {
  const STEPS = buildSteps(flow, onLangSelect, onDone, { hasAccounts, hasGeneratedAccount });
  const active = STEPS[flow.step];
  if (!active?.content) return null;

  // When user has accounts, back on the method step should close the wizard
  const showBack = flow.step !== WizardStep.PasskeyBackup && (flow.showBack || (flow.step === WizardStep.Method && !!hasAccounts));
  const handleBack = (flow.step === WizardStep.Method && hasAccounts) ? onClose : flow.goBack;

  return (
    <>
      {!active.noHeader && (
        <Container variant="row" className="justify-between px-8 py-6 border-b border-card-border">
          {showBack ? (
            // Same tone/size split as OverlayPanel's header nav (back is
            // brand-coloured, close is neutral) — this header hand-rolled its
            // own copy of that pair instead of reusing it.
            <IconButton tone="brand" size="large" onClick={handleBack!} aria-label={t('common.back')}>
              <IconChevronLeft />
            </IconButton>
          ) : (
            <div className="w-[36px]" />
          )}
          <span className="text-2xl font-bold text-heading">{active.title}</span>
          {onClose ? (
            <IconButton size="large" onClick={onClose} aria-label={t('common.close')}>
              <IconClose />
            </IconButton>
          ) : (
            <div className="w-[36px]" />
          )}
        </Container>
      )}
      {/* bodyClassName REPLACES the default padding rather than joining it —
          onboarding needs different padding, and two padding utilities on the
          same element would leave the winner up to Tailwind's generation
          order instead of the caller's intent. */}
      <Container className={`flex-1 overflow-y-auto ${bodyClassName || 'pt-10 px-8 pb-0'}`}>
        {active.content}
      </Container>
    </>
  );
}
