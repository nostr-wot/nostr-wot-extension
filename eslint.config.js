// ESLint 9 flat config.
//
// Deliberately NOT a formatting linter — no Prettier, no style rules. This
// repo has no formatter on purpose (see CLAUDE.md); the scope here is
// correctness and dead-code only.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import unusedImports from 'eslint-plugin-unused-imports';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'safari-build/**', 'safari-xcode/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // scripts/pqc-keygen.mjs is a plain Node CLI script, not part of the
  // extension bundle — it needs Node's globals (Buffer, console, process),
  // not the browser/webextension ones the rest of the config assumes.
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        // @typescript-eslint/scope-manager defaults jsxPragma to 'React' —
        // built for the classic transform, where `<div>` compiles to
        // `React.createElement` and a `React` import that looks unused is
        // secretly load-bearing. It only auto-detects otherwise via the
        // legacy `jsxFactory` compiler option, which this repo's
        // `"jsx": "react-jsx"` (automatic runtime, tsconfig.json) never
        // sets — so every file with JSX silently marked its `React` import
        // "used" regardless of whether anything referenced it. That hid
        // the exact ~40-file dead-import pile (`import React from 'react'`
        // left from the Tailwind migration) this config exists to catch.
        // Explicit null turns the synthetic reference off.
        jsxPragma: null,
        jsxFragmentName: null,
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
      'unused-imports': unusedImports,
    },
    settings: {
      react: { version: '19.2' },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,

      // React 19's automatic JSX runtime needs no React import in scope,
      // and every prop shape here is already checked by TypeScript.
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',

      // `jsx-uses-react` exists for the classic JSX transform, where `<div>`
      // compiles to `React.createElement` and an unused-looking `React`
      // import is actually load-bearing. This project's tsconfig sets
      // `"jsx": "react-jsx"` (the automatic runtime) so that is never true
      // here — leaving the rule on on hid the exact bug class this config
      // exists to catch: ~40 files still had a dead `import React from
      // 'react'` (the Tailwind-migration leftover), invisible to
      // unused-imports because this rule marks `React` "used" by the mere
      // presence of JSX in the file, regardless of whether anything
      // references it. `jsx-uses-vars` stays on — that one marks a
      // component reference inside JSX (`<Foo />`) as a real usage of
      // `Foo`, which plain no-unused-vars cannot see on its own and which
      // has nothing to do with which JSX transform is active.
      'react/jsx-uses-react': 'off',

      // Plain no-unused-vars only reports; unused-imports also fixes.
      // Turning off the TS version avoids the two disagreeing about the
      // same import.
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'error',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
          caughtErrors: 'none',
          // vault.ts and the account handlers destructure `{ privkeyBytes,
          // mnemonic, ...safe }` specifically to build the redacted shape
          // handed back to callers — the secret fields are "unused" only
          // because the whole point is to drop them via the rest sibling.
          // Flagging that would make the redaction pattern itself look like
          // dead code.
          ignoreRestSiblings: true,
        },
      ],

      // `catch (e: any)` to read `e.message` without narrowing, and `any`
      // at RPC/onboarding boundaries whose payload shape isn't modeled yet,
      // are the established convention in this codebase — 20+ production
      // files (every wizard step, several Settings screens) predate this
      // lint config and rely on it deliberately, not just test mocks.
      // Flipping this to an error would force typing a few dozen RPC
      // payloads as a side effect of "add a linter," which is a much
      // bigger and riskier change than this task calls for.
      '@typescript-eslint/no-explicit-any': 'off',

      // A handful of sites assert non-null one line after checking for
      // it (e.g. WizardSteps' `handleBack!`) — the check already happened,
      // the assertion just tells TS what the surrounding code guarantees.
      '@typescript-eslint/no-non-null-assertion': 'off',

      // docs/component-standards.md §10 documents a run-version/ref guard
      // for effects that must ignore a stale in-flight async result, and
      // several effects (useRpc, useAsyncResource, useWizardFlow, ...)
      // intentionally depend on a ref or omit a stable setter — each
      // already carries its own eslint-disable-next-line predating this
      // config. Enabling this as an error would demand the same disable
      // comment at every one of them for a pattern that is already
      // documented and reviewed; kept as a warning so a *new*, undocumented
      // missing dependency still surfaces without hard-failing the build.
      'react-hooks/exhaustive-deps': 'warn',

    },
  },

  // Promise-handling rules apply to application code only. node:test's own
  // idiom is an unawaited top-level `test('...', async () => {...})` call
  // per case — that is the runner's contract, not a floating-promise bug,
  // and turning these rules on repo-wide produced 1700+ "violations" that
  // were entirely this, in every test file.
  {
    files: ['src/**/*.{ts,tsx}', 'background.ts', 'content.ts', 'inject.ts'],
    rules: {
      // The popup unmounts on focus loss and its click handlers are
      // deliberately fire-and-forget (see docs/component-standards.md §10
      // on effects outliving the popup) — dozens of `onClick={handleFoo}`
      // wire an async handler straight to a DOM event with no await at
      // the call site, which is the same intentional pattern as a
      // void-prefixed async call in an effect. That is `checksVoidReturn.
      // attributes`. The exact same pattern recurs one level down, at
      // plain callback arguments rather than JSX props: `setInterval`/
      // `setTimeout(async () => ...)` polling loops (Nip46Step,
      // DepositDialog, SendDialog), `window.addEventListener('message',
      // async ...)` in content.ts/inject.ts, `port.onMessage.addListener
      // (async ...)` in background.ts, and hooks whose callback option is
      // typed `() => void` but handed an async function on purpose
      // (`useStorageWatch(..., reload)`, `useRelayCache(..., refresh)`,
      // `useVaultUnlock({ onSuccess: async () => ... })`). None of these
      // are the bug class the rule exists for — no `.forEach(async ...)`
      // or `.map(async ...)` exists anywhere in the tree (checked), which
      // is the actual dangerous shape (silently-unordered/unawaited
      // iteration). `no-misused-promises` stays on for everything else —
      // conditionals, spreads, class method overrides.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false, arguments: false } },
      ],

      // This is the actual regression class documented in
      // component-standards.md §5: a bare, un-awaited
      // `navigator.clipboard.writeText` made a refused clipboard write
      // look identical to a successful one. `void` already marks a
      // deliberately-unhandled promise (effects, fire-and-forget clicks
      // above) and is exempted by this rule's default `ignoreVoid`.
      '@typescript-eslint/no-floating-promises': 'error',

      // `catch {}` with nothing in it is the established "best effort, and
      // there is genuinely nothing to do about a failure here" idiom —
      // background.ts's postMessage back to a port that may already be
      // closed, and a few onboarding/account steps that continue past an
      // optional cleanup RPC on purpose. `allowEmptyCatch` keeps `no-empty`
      // for every other block (an empty `if`/`for`/function body is still
      // almost certainly a mistake).
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // `no-explicit-any` is already off repo-wide (see above) because the
  // convention isn't test-only — it also covers RPC/browser-mock `any` in
  // tests/, which would otherwise be the next place this rule would fire.
);
