import { WizardStep } from '@constants/wizard.ts';
/**
 * Pure wizard state machine -- no React dependencies.
 *
 * State shape: { step: string, ctx: { method, account, mnemonic, upgradeId, visitedPreMethod } }
 *
 * Reducer handles action { type, payload? } plus runtime `options` injected by the hook.
 */

export interface WizardContext {
  method: string | null;
  account: unknown | null;
  mnemonic: string | null;
  upgradeId: string | null;
  visitedPreMethod: boolean;
}

export interface WizardState {
  step: WizardStep;
  ctx: WizardContext;
}

export interface WizardAction {
  type: string;
  payload?: Record<string, unknown>;
}

export interface WizardOptions {
  initialStep?: WizardStep;
  skipLang?: boolean;
  hasAccounts?: boolean;
  hasGeneratedAccount?: boolean;
}

interface TransitionResult {
  step: WizardStep;
  ctx?: Partial<WizardContext>;
}

type TransitionHandler = (
  ctx: WizardContext,
  payload: Record<string, unknown>,
  options: WizardOptions
) => TransitionResult | null;

const TRANSITIONS: Record<WizardStep, Record<string, TransitionHandler>> = {
  [WizardStep.Language]: {
    NEXT: (_ctx) => ({ step: WizardStep.Method, ctx: { visitedPreMethod: true } }),
  },

  [WizardStep.Welcome]: {
    NEXT: (_ctx) => ({ step: WizardStep.Method, ctx: { visitedPreMethod: true } }),
  },

  [WizardStep.Method]: {
    SELECT: (_ctx, { method }, { hasGeneratedAccount }) => {
      const step = (method === 'create' && hasGeneratedAccount) ? WizardStep.Subaccount : method as WizardStep;
      if (![WizardStep.Passkey, WizardStep.PasskeyRestore, WizardStep.Create, WizardStep.Subaccount, WizardStep.Import, WizardStep.WatchOnly, WizardStep.NostrConnect].includes(step)) return null;
      return { step, ctx: { method: method as string } };
    },
    MORE_OPTIONS: () => ({ step: WizardStep.MoreOptions }),
    BACK: (ctx, _payload, { initialStep }) =>
      ctx.visitedPreMethod ? { step: initialStep! } : null,
  },

  [WizardStep.MoreOptions]: {
    SELECT: (_ctx, { method }, { hasAccounts }) => {
      const step = method as WizardStep;
      if (![WizardStep.WatchOnly, WizardStep.NostrConnect, WizardStep.PasskeyRestore].includes(step)) return null;
      if (hasAccounts && step === WizardStep.PasskeyRestore) return null;
      return { step, ctx: { method: method as string } };
    },
    BACK: () => ({ step: WizardStep.Method }),
  },

  [WizardStep.Passkey]: {
    CREATED: (_ctx, { account }) => ({ step: WizardStep.PasskeyBackup, ctx: { account } }),
    BACK: () => ({ step: WizardStep.Method }),
  },
  [WizardStep.PasskeyRestore]: {
    DONE: (_ctx, { account }) => ({ step: WizardStep.Done, ctx: { account } }),
    BACK: () => ({ step: WizardStep.MoreOptions }),
  },
  [WizardStep.PasskeyBackup]: {
    DONE: () => ({ step: WizardStep.FollowSuggestions }),
  },
  [WizardStep.Create]: {
    CREATED: (_ctx, { account, mnemonic }) => ({
      step: WizardStep.Verify,
      ctx: { account: account as unknown, mnemonic: mnemonic as string },
    }),
    BACK: () => ({ step: WizardStep.Method }),
  },

  [WizardStep.Subaccount]: {
    CREATED: (_ctx, { account }) => ({
      step: WizardStep.FollowSuggestions,
      ctx: { account: account as unknown },
    }),
    BACK: () => ({ step: WizardStep.Method }),
  },

  [WizardStep.Import]: {
    IMPORTED: (_ctx, { account, upgradeId }) => ({
      step: WizardStep.Password,
      ctx: { account: account as unknown, upgradeId: upgradeId as string },
    }),
    BACK: () => ({ step: WizardStep.Method }),
  },

  [WizardStep.WatchOnly]: {
    DONE: (_ctx, { account }, { hasAccounts }) => ({
      step: hasAccounts ? WizardStep.PermissionCopy : WizardStep.Done,
      ctx: { account: account as unknown },
    }),
    BACK: () => ({ step: WizardStep.MoreOptions }),
  },

  [WizardStep.NostrConnect]: {
    DONE: (_ctx, { account }) => ({ step: WizardStep.Password, ctx: { account: account as unknown } }),
    BACK: () => ({ step: WizardStep.MoreOptions }),
  },

  [WizardStep.Backup]: {
    DONE: () => ({ step: WizardStep.Verify }),
    BACK: () => ({ step: WizardStep.Create }),
  },

  [WizardStep.Verify]: {
    VERIFIED: () => ({ step: WizardStep.Password }),
    BACK: () => ({ step: WizardStep.Create }),
  },

  [WizardStep.Password]: {
    SET: (ctx, { upgraded }, { hasAccounts }) => {
      if (upgraded) return { step: WizardStep.Done };
      // Only show follow suggestions for new identity creation
      if (ctx.method === 'create') return { step: WizardStep.FollowSuggestions };
      return { step: hasAccounts ? WizardStep.PermissionCopy : WizardStep.Done };
    },
    BACK: (ctx) => {
      if (ctx.method === 'create') return { step: WizardStep.Verify };
      if (ctx.method === 'import') return { step: WizardStep.Import };
      if (ctx.method === 'nip46') return { step: WizardStep.NostrConnect };
      return { step: WizardStep.Method };
    },
  },

  [WizardStep.FollowSuggestions]: {
    DONE: (_ctx, _payload, { hasAccounts }) => ({ step: hasAccounts ? WizardStep.PermissionCopy : WizardStep.Done }),
    BACK: (ctx, _payload, { hasGeneratedAccount }) => {
      if (ctx.method === 'passkey') return { step: WizardStep.PasskeyBackup };
      // Subaccounts skip password, go back to subaccount step
      if (ctx.method === 'create' && hasGeneratedAccount) return { step: WizardStep.Subaccount };
      return { step: WizardStep.Password };
    },
  },

  [WizardStep.PermissionCopy]: {
    DONE: () => ({ step: WizardStep.Done }),
    BACK: (ctx) => {
      if (ctx.method === 'create') return { step: WizardStep.FollowSuggestions };
      return { step: WizardStep.Password };
    },
  },

  [WizardStep.Done]: {
    // terminal -- no transitions
  },
};

export function createInitialState({ initialStep = WizardStep.Language, skipLang = false }: WizardOptions = {}): WizardState {
  const step = skipLang ? WizardStep.Method : initialStep;
  return {
    step,
    ctx: {
      method: null,
      account: null,
      mnemonic: null,
      upgradeId: null,
      visitedPreMethod: skipLang,
    },
  };
}

export function reducer(state: WizardState, action: WizardAction, options: WizardOptions = {}): WizardState {
  if (action.type === 'RESET') {
    return createInitialState(options);
  }

  if (action.type === 'RESTORE' && action.payload) {
    const restoredStep = action.payload.step === 'archive' ? WizardStep.Done : action.payload.step;
    if (!Object.values(WizardStep).includes(restoredStep as WizardStep)) return state;
    return {
      step: restoredStep as WizardStep,
      ctx: action.payload.ctx as unknown as WizardContext,
    };
  }

  const stepTransitions = TRANSITIONS[state.step];
  if (!stepTransitions) return state;

  const handler = stepTransitions[action.type];
  if (!handler) return state;

  const result = handler(state.ctx, action.payload || {}, options);
  if (!result) return state; // guard blocked

  return {
    step: result.step,
    ctx: { ...state.ctx, ...result.ctx },
  };
}
