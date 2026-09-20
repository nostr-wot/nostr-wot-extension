import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Button from '../src/components/Button';
import OverlayPanel from '../src/components/OverlayPanel';
import ScreenReaderStatus from '../src/components/ScreenReaderStatus';
import PulseLogo from '../src/components/PulseLogo';
import ScrollWheelPicker from '../src/components/ScrollWheelPicker';
import IconButton from '../src/components/IconButton';
import ApprovalCard from '../src/screens/Approval/ApprovalCard';

it('icon buttons use only the three standard hit areas and shared tones', () => {
  for (const [size, pixels] of [['small', 24], ['default', 28], ['large', 36]] as const) {
    const html = renderToStaticMarkup(IconButton({ size, tone: 'brand', disabled: true, children: 'Icon', 'aria-label': 'Action' }));
    assert.ok(html.includes(`width:${pixels}px;height:${pixels}px`));
    assert.match(html, /text-brand/);
    assert.match(html, /disabled=""/);
    assert.match(html, /aria-label="Action"/);
  }
});

it('remote approval details and cancellation are separate, named button actions', () => {
  let opened = 0, cancelled = 0;
  const props = {
    group: { origin: 'site.test', method: 'signEvent', permKey: 'signEvent', requests: [], nip46InFlight: true },
    onClick() { opened++; }, onCancel() { cancelled++; },
  };
  const tree = ApprovalCard(props);
  const [row, cancel] = tree.props.children.props.children;
  row.props.onClick();
  cancel.props.onClick();
  assert.equal(opened, 1);
  assert.equal(cancelled, 1);
  const html = renderToStaticMarkup(tree);
  assert.equal((html.match(/<button\b/g) || []).length, 2);
  assert.ok(html.indexOf('</button>') < html.lastIndexOf('<button'));
  assert.match(html, /aria-label="approval.cancelNip46"/);
  assert.doesNotMatch(html.slice(html.lastIndexOf('<button')), /text-2xl|leading-none|rounded-sm|&times;/);
});

it('wheel styling preserves the selected option, perspective, masks and row geometry', () => {
  const html = renderToStaticMarkup(createElement(ScrollWheelPicker<string>, {
    items: ['First', 'Second', 'Third'], selectedIndex: 1, itemHeight: 40, visibleCount: 5,
  }));
  assert.match(html, /tabindex="0" role="listbox"/);
  assert.match(html, /height:200px/);
  assert.match(html, /perspective:900px/);
  assert.match(html, /-webkit-mask-image:linear-gradient/);
  assert.match(html, /backface-visibility:hidden/);
  assert.match(html, /transform:rotateX\(0deg\)[^>]*role="option" aria-selected="true">Second/);
  assert.equal((html.match(/role="option"/g) || []).length, 3);
});

it('pulse logo preserves two decorative staggered rings and the accessible image', () => {
  const html = renderToStaticMarkup(createElement(PulseLogo, { src: '/logo.png', size: 72, alt: 'Nostr WoT' }));
  assert.equal((html.match(/aria-hidden="true"/g) || []).length, 2);
  assert.equal((html.match(/animate-logo-pulse/g) || []).length, 2);
  assert.equal((html.match(/animation-delay:2.5s/g) || []).length, 1);
  assert.match(html, /width="72" height="72" alt="Nostr WoT"/);
});

it('screen-reader status stays mounted when empty and renders feedback as text', () => {
  for (const message of [undefined, '', 'Copied', 'Copy failed', '<script>']) {
    const html = renderToStaticMarkup(createElement(ScreenReaderStatus, {}, message));
    assert.match(html, /^<span role="status" class="sr-only">.*<\/span>$/);
    assert.doesNotMatch(html, /aria-hidden|display:none|<script>/);
    if (message === '<script>') assert.match(html, /&lt;script&gt;/);
    else if (message) assert.ok(html.includes(message));
    else assert.match(html, /><\/span>$/);
  }
});

it('filled buttons suppress the native browser border while outline buttons retain theirs', () => {
  const filled = renderToStaticMarkup(createElement(Button, { variant: 'secondary' }, 'Cancel'));
  assert.match(filled, /border-0/);
  const outline = renderToStaticMarkup(createElement(Button, { variant: 'secondary', outline: true }, 'Cancel'));
  assert.match(outline, /border-card-border/);
  assert.doesNotMatch(outline, /border-0/);
});

it('overlay close controls have an accessible name in the uncentered header', () => {
  const html = renderToStaticMarkup(createElement(OverlayPanel, { title: 'Activity', onClose() {} }));
  assert.match(html, /aria-label="common.close"/);
  assert.match(html, /border-none/);
});

import Input from '../src/components/Input';
import InputRow from '../src/components/InputRow';
import EditableList from '../src/components/EditableList';

it('input errors are associated with the field and labels focus their input', () => {
  const html = renderToStaticMarkup(createElement(Input, { id: 'pubkey', label: 'Public key', error: 'Invalid key' }));
  assert.match(html, /for="pubkey"/);
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /aria-describedby="pubkey-error"/);
  assert.match(html, /id="pubkey-error"/);
});

it('empty and invalid input rows cannot submit', () => {
  for (const props of [{ value: '  ' }, { value: 'bad', error: 'Invalid' }, { value: 'valid', disabled: true }]) {
    const html = renderToStaticMarkup(createElement(InputRow, { onChange() {}, buttonLabel: 'Add', ...props }));
    assert.match(html, /<button[^>]*disabled=""/);
  }
});

it('validated list adds use a named SVG plus button', () => {
  const html = renderToStaticMarkup(createElement(EditableList, {
    items: [], inputValue: 'alice', onInputChange() {}, onRemove() {}, onAdd() {},
    placeholder: 'Person', buttonLabel: 'Add person', validate: raw => raw,
  }));
  assert.match(html, /<button[^>]*aria-label="Add person"/);
  assert.match(html, /<svg/);
  assert.doesNotMatch(html, /<button[^>]*disabled=""/);
  assert.doesNotMatch(html, />Add person<\/button>/);
});

it('list adds reject invalid, whitespace-normalized and duplicate entries before submission', () => {
  for (const [inputValue, validate] of [
    ['invalid', () => null], ['#', () => ''], ['ALICE', (s: string) => s.toLowerCase()],
  ] as const) {
    const html = renderToStaticMarkup(createElement(EditableList, {
      items: ['alice'], inputValue, validate, onInputChange() {}, onRemove() {},
      placeholder: 'Person', buttonLabel: 'Add',
    }));
    assert.match(html, /<button[^>]*disabled=""/);
  }
});

import Select from '../src/components/Select';
import Dropdown from '../src/components/Dropdown';
import RemoveButton from '../src/components/RemoveButton';

it('select and dropdown retain native keyboard semantics and disabled state', () => {
  for (const component of [Select, Dropdown]) {
    const html = renderToStaticMarkup(createElement(component as typeof Dropdown, {
      options: [{ value: 'one', label: 'First' }], value: 'one', onChange() {}, disabled: true, 'aria-label': 'Account',
    }));
    assert.match(html, /<select[^>]*disabled=""[^>]*aria-label="Account"/);
    assert.match(html, /<option[^>]*selected=""[^>]*>First/);
  }
});
it('remove controls have an accessible name and honor disabled state', () => {
  const html = renderToStaticMarkup(createElement(RemoveButton, { disabled: true }));
  assert.match(html, /aria-label="common.remove"/);
  assert.match(html, /disabled=""/);
});

import PublishRow from '../src/components/PublishRow';
it('publishing stays disabled when the editor has no valid changes', () => {
  const html = renderToStaticMarkup(createElement(PublishRow, {
    disabled: true, publishing: false, dirty: false, status: null, onPublish() {},
    labels: { idle: 'Saved', unsaved: 'Changed', success: 'Saved', error: 'Error', publishing: 'Publishing' },
  }));
  assert.match(html, /<button[^>]*disabled=""/);
});

it('showing an input validation error keeps the same wrapper so typing retains focus', () => {
  const clean = renderToStaticMarkup(createElement(Input, { id: 'field' }));
  const invalid = renderToStaticMarkup(createElement(Input, { id: 'field', error: 'Invalid' }));
  // React must reconcile the existing input at the same position instead of
  // replacing the input with a newly inserted wrapper when an error appears.
  assert.equal(clean.slice(0, clean.indexOf('<input')), invalid.slice(0, invalid.indexOf('<input')));
});

it('Enter follows the same validation gate as clicking Add', () => {
  for (const [value, disabled, error, expected] of [
    ['', false, '', 0], ['bad', false, 'Invalid', 0], ['good', true, '', 0], ['good', false, '', 1],
  ] as const) {
    let submitted = 0;
    const row = InputRow({ value, disabled, error, buttonLabel: 'Add', onChange() {}, onSubmit() { submitted++; } });
    const input = row.props.children.props.children[0].props.children;
    input.props.onKeyDown({ key: 'Enter', preventDefault() {} });
    assert.equal(submitted, expected);
  }
});

it('inputs and selects use the shared contrasting input surface', () => {
  assert.match(renderToStaticMarkup(createElement(Input, {})), /bg-input/);
  assert.match(renderToStaticMarkup(createElement(Select, {options:[]})), /bg-input/);
});

import CopyButton from '../src/components/CopyButton';

it('shared copy actions expose their purpose and never render the copied credential', () => {
  for (const iconOnly of [true, false]) {
    const html = renderToStaticMarkup(createElement(CopyButton, { value:'private-connection-value',label:'Copy connection',iconOnly,disabled:true }));
    assert.match(html, /aria-label="Copy connection"/);
    assert.match(html, /role="status"/);
    assert.match(html, /<button[^>]*disabled=""/);
    assert.doesNotMatch(html, /private-connection-value/);
  }
});

it('shared date and search fields retain native types, labels and control styling', () => {
  for (const type of ['date','search'] as const) {
    const html=renderToStaticMarkup(createElement(Input,{type,id:type,label:type,value:'',onChange(){}}));
    assert.match(html,new RegExp(`type="${type}"`));
    assert.match(html,new RegExp(`for="${type}"`));
    assert.match(html,/border-control-border/);
  }
});

import Tabs from '../src/components/Tabs';
import ChipGroup from '../src/components/ChipGroup';
import type { Option } from '../src/components/option.ts';

it('selection controls share readonly options while preserving string and numeric values', () => {
  const options: readonly Option<'all'|'in'>[]=[{value:'all',label:'All'},{value:'in',label:'Received'}];
  const tabs=renderToStaticMarkup(createElement(Tabs<'all'|'in'>,{options,value:'in',onChange(){}}));
  assert.match(tabs,/aria-selected="true"[^>]*>Received/);
  const chips=renderToStaticMarkup(createElement(ChipGroup<0|1>,{options:[{value:0,label:'Zero'},{value:1,label:'One'}],value:0,onChange(){}}));
  assert.match(chips,/Zero/);assert.match(chips,/One/);
  type Selected = Parameters<typeof ChipGroup<'all'|'in'>>[0]['onChange'];
  const retainsLiteralUnion: Parameters<Selected>[0] extends 'all'|'in' ? true : false = true;
  assert.equal(retainsLiteralUnion,true);
});

import { Button as NamedButton, ButtonSecondary, ButtonDanger } from '../src/components/Button';
it('named button presets preserve standard styling and native behavior', () => {
  assert.equal(NamedButton, Button);
  for (const [Preset, variant] of [[ButtonSecondary, 'secondary'], [ButtonDanger, 'danger']] as const) {
    const onClick = () => {};
    const props = {small:true,outline:true,disabled:true,type:'submit' as const,'aria-label':'Confirm',onClick,children:'Confirm'};
    assert.equal(Preset(props).props.onClick,onClick);
    assert.equal(renderToStaticMarkup(createElement(Preset,props)),renderToStaticMarkup(createElement(Button,{...props,variant})));
    // A runtime spread cannot override a named preset's variant.
    assert.equal(Preset({...props,variant:'primary'} as never).props.variant,variant);
  }
});

it('input hints reuse a focusable info tooltip beside the associated label', () => {
  const html = renderToStaticMarkup(createElement(Input, { id: 'limit', label: 'Limit', hint: 'Leave empty for unlimited.' }));
  assert.match(html, /for="limit"/);
  assert.match(html, /tabindex="0" role="button" aria-label="Leave empty for unlimited\."/);
  assert.doesNotMatch(html, /<input[^>]* hint=/);
});

it('shared help opens on click/focus, stays within the viewport and dismisses without triggering its parent', async () => {
  const { JSDOM } = await import('jsdom');
  const { act } = await import('react');
  const { default: InfoTooltip } = await import('../src/components/InfoTooltip');
  const dom = new JSDOM('<div id="root"></div>');
  const globals = new Map(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  Object.defineProperties(globalThis, {window:{value:dom.window,configurable:true},document:{value:dom.window.document,configurable:true},IS_REACT_ACT_ENVIRONMENT:{value:true,configurable:true}});
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    showPopover: {value:function(this: HTMLElement) { this.dataset.open = 'true'; }, configurable:true},
    hidePopover: {value:function(this: HTMLElement) { delete this.dataset.open; }, configurable:true},
  });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  let parentClicks = 0, parentKeys = 0;
  try {
    await act(async () => root.render(createElement('div', {onClick:()=>{parentClicks++;},onKeyDown:()=>{parentKeys++;}},createElement(InfoTooltip,{text:'Explanation'}))));
    const trigger = dom.window.document.querySelector<HTMLElement>('[role=button]')!;
    const tip = dom.window.document.querySelector<HTMLElement>('[role=tooltip]')!;
    Object.defineProperty(dom.window, 'innerWidth', {value:320, configurable:true});
    Object.defineProperty(dom.window, 'innerHeight', {value:200, configurable:true});
    trigger.getBoundingClientRect = () => ({left:300,top:2,bottom:18,width:16} as DOMRect);
    tip.getBoundingClientRect = () => ({height:70} as DOMRect);
    await act(async () => trigger.click());
    assert.equal(parentClicks, 0);
    assert.equal(tip.dataset.open, 'true');
    assert.equal(trigger.getAttribute('aria-describedby'), tip.id);
    assert.equal(tip.style.left, '72px');
    assert.equal(tip.style.top, '24px', 'flips below a trigger near the top edge');
    await act(async () => trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    assert.equal(parentKeys, 0);
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    await act(async () => trigger.focus());
    assert.equal(tip.dataset.open, 'true');
    await act(async () => dom.window.document.body.dispatchEvent(new dom.window.MouseEvent('mousedown',{bubbles:true})));
    assert.equal(tip.dataset.open, undefined);
    await act(async () => trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
    assert.equal(tip.dataset.open, 'true');
    await act(async () => dom.window.document.dispatchEvent(new dom.window.Event('scroll')));
    assert.equal(tip.dataset.open, undefined);
    await act(async () => root.unmount());
  } finally {
    dom.window.close();
    for (const [key, value] of globals) { if (value) Object.defineProperty(globalThis,key,value);else delete (globalThis as any)[key]; }
  }
});


it('split button segments keep standard tones and join only their inner corners', () => {
  for (const variant of ['primary', 'danger'] as const) {
    const start = renderToStaticMarkup(createElement(Button, {variant, segment:'start'}, 'Action'));
    const end = renderToStaticMarkup(createElement(Button, {variant, segment:'end', 'aria-label':'More actions'}, 'Arrow'));
    assert.match(start, /rounded-r-none/);
    assert.match(end, /rounded-l-none/);
    assert.match(end, /border-l-current\/20/);
    assert.match(end, /aria-label="More actions"/);
  }
  assert.doesNotMatch(renderToStaticMarkup(createElement(Button, null, 'Normal')), /rounded-[lr]-none/);
});
