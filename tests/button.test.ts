import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Button from '../src/components/Button/Button';
import OverlayPanel from '../src/components/OverlayPanel/OverlayPanel';

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

import Input from '../src/components/Input/Input';
import InputRow from '../src/components/InputRow/InputRow';
import EditableList from '../src/components/EditableList/EditableList';

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

import Select from '../src/components/Select/Select';
import Dropdown from '../src/components/Dropdown/Dropdown';
import RemoveButton from '../src/components/RemoveButton/RemoveButton';

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

import PublishRow from '../src/components/PublishRow/PublishRow';
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

import CopyButton from '../src/components/CopyButton/CopyButton';

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
