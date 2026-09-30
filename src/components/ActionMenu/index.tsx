import { useLayoutEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { Option } from '@components/option.ts';
import useOutsideClick from '@hooks/useOutsideClick';
import Card from '@components/Card';
import Button from '@components/Button';
import { cn } from '@utils/cn.ts';

interface ActionMenuProps<T extends string> {
    label: string;
    options: readonly Option<T>[];
    onSelect: (value: T) => Promise<boolean | void>;
    trigger: (props: ButtonHTMLAttributes<HTMLButtonElement>) => ReactNode;
    disabled?: boolean;
    tone?: 'neutral' | 'danger';
    placement?: 'above' | 'below';
    description?: ReactNode;
    align?: 'start' | 'end';
    anchorToParent?: boolean;
    matchAnchorWidth?: boolean;
}

/** Anchored actions, distinct from a value-selecting Dropdown and a modal dialog. */
export default function ActionMenu<T extends string>({ label, options, onSelect, trigger, disabled = false, tone = 'neutral', placement = 'below', description, align = 'end', anchorToParent = false, matchAnchorWidth = false }: ActionMenuProps<T>) {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const wrapper = useRef<HTMLDivElement>(null);
    const menu = useRef<HTMLDivElement>(null);
    const id = useId();
    useOutsideClick(wrapper, () => setOpen(false), open);
    useLayoutEffect(() => {
        const panel = menu.current;
        const anchor = anchorToParent ? wrapper.current?.parentElement : wrapper.current;
        if (!open || !panel || !anchor) return;
        panel.showPopover?.();
        function position() {
            const rect = anchor!.getBoundingClientRect();
            const availableWidth = Math.max(0, window.innerWidth - 16);
            panel!.style.width = matchAnchorWidth ? `${Math.min(rect.width, availableWidth)}px` : 'max-content';
            panel!.style.maxWidth = `${Math.min(260, availableWidth)}px`;
            panel!.style.minWidth = `${Math.min(176, availableWidth)}px`;
            const width = panel!.getBoundingClientRect().width;
            const above = Math.max(0, rect.top - 16);
            const below = Math.max(0, window.innerHeight - rect.bottom - 16);
            const upwards = placement === 'above' ? above >= Math.min(240, panel!.scrollHeight) || above >= below
                : below < Math.min(240, panel!.scrollHeight) && above > below;
            panel!.style.maxHeight = `${Math.min(240, upwards ? above : below)}px`;
            panel!.style.left = `${Math.max(8, Math.min(align === 'start' ? rect.left : rect.right - width, window.innerWidth - width - 8))}px`;
            panel!.style.top = `${upwards ? Math.max(8, rect.top - panel!.getBoundingClientRect().height - 8) : rect.bottom + 8}px`;
        }
        position();
        panel.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
        const onScroll = (event: Event) => { if (!panel.contains(event.target as Node)) setOpen(false); };
        window.addEventListener('resize', position);
        document.addEventListener('scroll', onScroll, true);
        return () => {
            panel.hidePopover?.();
            window.removeEventListener('resize', position);
            document.removeEventListener('scroll', onScroll, true);
        };
    }, [open, anchorToParent, matchAnchorWidth, align, placement]);
    function close() {
        setOpen(false);
        wrapper.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.focus({ preventScroll: true });
    }
    async function select(value: T) {
        if (disabled || busy) return;
        setBusy(true);
        try {
            if (await onSelect(value) !== false) close();
        } finally { setBusy(false); }
    }
    return <div ref={wrapper} className={cn('shrink-0', !anchorToParent && 'relative')}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}
        onKeyDown={event => {
            if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); }
            if (disabled || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            if (!open) { setOpen(true); return; }
            const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
            const current = items.indexOf(document.activeElement as HTMLButtonElement);
            const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
                : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
            items[index]?.focus({ preventScroll: true });
        }}>
        {trigger({ disabled, 'aria-label': label, 'aria-haspopup': 'menu', 'aria-expanded': open,
            'aria-controls': open ? id : undefined, onClick: () => setOpen(value => !value) })}
        {open && <div ref={menu} id={id} role="menu" aria-label={label} popover="manual"
            style={{ inset: 'auto' }} className="fixed m-0 p-0 border-0 bg-transparent overflow-y-auto">
            <Card variant="elevated" className="mb-0 p-2">
                <div className="flex flex-col gap-2">
                    {options.map(option => <Button variant={tone === 'danger' ? 'danger' : 'secondary'} key={option.value} small role="menuitem" tabIndex={-1} aria-disabled={busy || disabled} onClick={() => { void select(option.value); }}>{option.label}</Button>)}
                </div>
                {description}
            </Card>
        </div>}
    </div>;
}
