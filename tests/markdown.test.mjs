import { test } from 'node:test';
import assert from 'node:assert/strict';
import { excerpt, notesText, renderNotes } from '../scripts/lib/markdown.mjs';

test('empty notes give an empty string', () => {
  assert.equal(renderNotes(''), '');
  assert.equal(renderNotes('  \n\n  '), '');
  assert.equal(renderNotes(undefined), '');
  assert.equal(notesText(''), '');
});

test('paragraphs split on blank lines and single newlines become spaces', () => {
  assert.equal(renderNotes('One\ntwo\n\nThree'), '<p>One two</p><p>Three</p>');
  assert.equal(renderNotes('A\r\n\r\nB'), '<p>A</p><p>B</p>');
  assert.equal(renderNotes('A\n \t\nB'), '<p>A</p><p>B</p>');
});

test('strong, emphasis and code render', () => {
  assert.equal(renderNotes('a **b** *c* `d`'), '<p>a <strong>b</strong> <em>c</em> <code>d</code></p>');
});

test('http and https links open in a new tab with a safe rel', () => {
  assert.equal(
    renderNotes('See [the docs](https://example.com/a?b=1&c=2) or [plain](http://example.com).'),
    '<p>See <a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">the docs</a> or <a href="http://example.com" target="_blank" rel="noopener noreferrer">plain</a>.</p>',
  );
});

test('script tags and attributes are escaped', () => {
  const html = renderNotes('<script>alert("x")</script> and <img src=x onerror=\'y\'>');
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('<img'));
  assert.equal(html, '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; and &lt;img src=x onerror=&#39;y&#39;&gt;</p>');
});

test('a quote in a link target cannot break out of the attribute', () => {
  const html = renderNotes('[x](https://example.com/"onmouseover="alert(1))');
  assert.ok(!html.includes('"onmouseover'));
  assert.ok(html.includes('&quot;onmouseover'));
});

test('links that are not http or https stay as text', () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com', '/relative', 'mailto:a@example.com']) {
    const html = renderNotes(`[x](${bad})`);
    assert.ok(!html.includes('<a'), bad);
    assert.ok(html.includes('[x]('), bad);
  }
});

test('emphasis nests inside link text', () => {
  assert.equal(
    renderNotes('[a **b** and *c*](https://example.com)'),
    '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">a <strong>b</strong> and <em>c</em></a></p>',
  );
});

test('markup inside code spans stays literal', () => {
  assert.equal(renderNotes('`**not bold** [x](https://example.com) <b>`'), '<p><code>**not bold** [x](https://example.com) &lt;b&gt;</code></p>');
  assert.equal(renderNotes('*a* `*b*` *c*'), '<p><em>a</em> <code>*b*</code> <em>c</em></p>');
});

test('asterisks inside a link address are not read as emphasis', () => {
  const html = renderNotes('[x](https://example.com/*a*/*b*) and *y*');
  assert.ok(html.includes('href="https://example.com/*a*/*b*"'));
  assert.ok(html.includes('<em>y</em>'));
});

test('a stray control character in the notes cannot forge a held span', () => {
  const html = renderNotes(`a ${String.fromCharCode(0)}0${String.fromCharCode(0)} b`);
  assert.equal(html, '<p>a 0 b</p>');
});

test('notesText removes markup, keeps link text and collapses whitespace', () => {
  assert.equal(notesText('A **bold**  and *soft* `code`\nline\n\n[link *text*](https://example.com) end'), 'A bold and soft code line link text end');
  assert.equal(notesText('[x](javascript:alert(1))'), '[x](javascript:alert(1))');
  assert.equal(notesText('1 < 2 & "q"'), '1 < 2 & "q"');
});

test('excerpt returns text that fits unchanged', () => {
  assert.equal(excerpt('short'), 'short');
  const exact = 'a'.repeat(160);
  assert.equal(excerpt(exact), exact);
});

test('excerpt cuts at the last space at or before max minus three', () => {
  assert.equal(excerpt('aaaa bbbb cccc dddd', 12), 'aaaa bbbb...');
  // A space exactly at max - 3 is a valid cut.
  assert.equal(excerpt('aaaaaaaaa bbbbbbbb', 12), 'aaaaaaaaa...');
  const long = `${'word '.repeat(60)}end`;
  const out = excerpt(long);
  assert.ok(out.length <= 160);
  assert.ok(out.endsWith('word...'));
});

test('excerpt hard cuts a single long word', () => {
  assert.equal(excerpt('x'.repeat(200)), `${'x'.repeat(157)}...`);
});
