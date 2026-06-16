// tests/shared/html/index.test.ts  ←mirrors→  src/shared/html/index.ts
import { expect, test } from 'bun:test'
import { decodeEntities, stripTags } from '../../../src/shared/html/index.ts'

test('decodeEntities handles named, numeric and hex entities', () => {
  expect(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot;')).toBe('a & b <c> "d"')
  expect(decodeEntities('&#39;&#x27;&apos;')).toBe("'''")
  expect(decodeEntities('x&nbsp;y')).toBe('x y')
  expect(decodeEntities('&#65;&#x41;')).toBe('AA')
})

test('decodeEntities drops out-of-range code points safely', () => {
  expect(decodeEntities('&#99999999999;')).toBe('')
})

test('stripTags removes tags, decodes entities and collapses whitespace', () => {
  expect(stripTags('<p>Hi   &amp;   bye</p>')).toBe('Hi & bye')
  expect(stripTags('<a class="x">  Download Node.js&reg;  </a>')).toBe('Download Node.js&reg;')
})
