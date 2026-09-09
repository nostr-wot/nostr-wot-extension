import { useState, useRef } from 'react';
import { t } from '@services/i18n/i18n.ts';
import { formatPermissionLabel } from '@services/i18n/permissionLabels.ts';
import { DECISIONS } from '@constants/permissions.ts';
import useOutsideClick from '@hooks/useOutsideClick.ts';
import Card from '@components/Card';
import Chip from '@components/Chip';
import Container from '@components/Container';

/**
 * Decision -> dot colour, as an explicit map rather than `styles[`permDot${...}`]`.
 *
 * The dynamic lookup was invisible to `tests/css-selectors.test.ts` (it
 * skips any stylesheet a component indexes into with a computed key) and it
 * is the only reason Settings.module.css was exempt from that test. Naming
 * the three cases here removes the dynamic access, so the rest of this
 * file's CSS module usage is checked like every other component's.
 */
const DECISION_DOT_TONE: Record<string, string> = {
  allow: 'bg-success',
  deny: 'bg-error',
  ask: 'bg-warning',
};

interface PermissionRulesListProps {
  keys: string[];
  permissions: Record<string, string>;
  onChange: (key: string, decision: string) => Promise<void>;
}

/** Bucket-independent rule rendering and decision-menu state. */
export default function PermissionRulesList({ keys, permissions, onChange }: PermissionRulesListProps) {
  // ── Inline decision dropdown state ──
  const [openDropdownKey, setOpenDropdownKey] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useOutsideClick(dropdownRef, () => setOpenDropdownKey(null), !!openDropdownKey);

  return (
    <Card>
      {keys.map((key) => {
        const current = permissions[key] || 'ask';
        return (
          <Container key={key} variant="row" className="justify-between py-5 border-b border-card last:border-b-0">
            <span className="text-md font-medium text-body">
              {formatPermissionLabel(key)}
            </span>
            <div className="relative shrink-0" ref={openDropdownKey === key ? dropdownRef : undefined}>
              {/* Always toned: this chip is not a selection among
                  options, it is the decision currently in force, and its
                  colour is how that reads at a glance. */}
              <Chip
                selected
                tone={current as 'allow' | 'deny' | 'ask'}
                onClick={() => setOpenDropdownKey(openDropdownKey === key ? null : key)}
              >
                {t(`perms.${current}`)}
              </Chip>
              {openDropdownKey === key && (
                // Not <Dropdown>: Dropdown owns its own trigger button;
                // here the trigger is already the Chip above, opening a
                // compact popover anchored to it. Not ListRow either —
                // a full title/subtitle/chevron row would dwarf this
                // 100px-wide menu of status-dot + label options.
                <div className="absolute right-0 top-[calc(100%+4px)] z-raised bg-elevated border border-card-border rounded-md shadow-[0_4px_16px_rgb(0_0_0_/_0.12)] min-w-50 overflow-hidden">
                  {DECISIONS.map((d) => (
                    <button
                      key={d}
                      className={`flex items-center gap-3 w-full py-3.5 px-6 border-none bg-transparent text-sm font-medium text-body cursor-pointer font-[inherit] text-left transition-colors hover:bg-brand-tint-hover ${d === current ? 'font-bold' : ''}`}
                      onClick={() => { void onChange(key, d); setOpenDropdownKey(null); }}
                    >
                      <span className={`w-[7px] h-[7px] rounded-full shrink-0 ${DECISION_DOT_TONE[d]}`} />
                      {t(`perms.${d}`)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Container>
        );
      })}
    </Card>
  );
}
