import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import StatusNotice from '../src/components/StatusNotice/StatusNotice';

describe('StatusNotice', () => {
  it('renders an error callout with its full explanation and an unshrinking icon', () => {
    const html = renderToStaticMarkup(createElement(StatusNotice, {
      tone: 'error', variant: 'callout', icon: createElement('svg'),
    }, 'Keep your recovery phrase private.'));
    assert.match(html, /text-error/);
    assert.match(html, /bg-error-tint/);
    assert.match(html, /items-start/);
    assert.match(html, /shrink-0/);
    assert.match(html, /Keep your recovery phrase private\./);
    assert.doesNotMatch(html, /<strong/);
  });

  it('keeps a callout title and rich body together with caller spacing', () => {
    const html = renderToStaticMarkup(createElement(StatusNotice, {
      tone: 'warn', variant: 'callout', icon: createElement('svg'),
      label: 'Unavailable', className: 'mb-6',
    }, createElement('p', null, 'This account cannot derive keys.')));
    assert.match(html, /mb-6/);
    assert.match(html, /<strong[^>]*>Unavailable<\/strong>/);
    assert.match(html, /<p>This account cannot derive keys\.<\/p>/);
    assert.match(html, /min-w-0/);
  });

  it('preserves the existing status label, keyboard tooltip, and action', () => {
    const html = renderToStaticMarkup(createElement(StatusNotice, {
      tone: 'ok', icon: createElement('svg'), label: 'Ready', info: 'Derived from your seed.',
    }, createElement('button', null, 'Details')));
    assert.match(html, /text-success-strong/);
    assert.match(html, /tabindex="0"/);
    assert.match(html, /aria-label="Derived from your seed\."/);
    assert.match(html, /<button>Details<\/button>/);
  });
});
