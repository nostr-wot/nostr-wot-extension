import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
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
    useEffect(() => { if (open) menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus(); }, [open]);
    function close() {
        setOpen(false);
        wrapper.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.focus();
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
            items[index]?.focus();
        }}>
        {trigger({ disabled, 'aria-label': label, 'aria-haspopup': 'menu', 'aria-expanded': open,
            'aria-controls': open ? id : undefined, onClick: () => setOpen(value => !value) })}
        {open && <Card variant="elevated" className={cn('absolute z-10 mb-0 p-2 max-h-60 overflow-y-auto', matchAnchorWidth ? 'w-full box-border' : 'min-w-36 w-max max-w-[min(320px,calc(100vw-32px))]', align === 'start' ? 'left-0' : 'right-0', placement === 'above' ? 'bottom-full mb-2' : 'top-full mt-2')}>
            <div ref={menu} id={id} role="menu" aria-label={label} className="flex flex-col gap-2">
                {options.map(option => <Button variant={tone === 'danger' ? 'danger' : 'secondary'} key={option.value} small role="menuitem" tabIndex={-1} aria-disabled={busy || disabled} onClick={() => { void select(option.value); }}>{option.label}</Button>)}
            </div>
            {description}
        </Card>}
    </div>;
}
