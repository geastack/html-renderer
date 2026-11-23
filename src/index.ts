import type { Element } from '@geastack/core'
import { registerCss, registerInline } from './css'

function nameChar(c: string): boolean {
  return (
    (c >= 'a' && c <= 'z') ||
    (c >= 'A' && c <= 'Z') ||
    (c >= '0' && c <= '9') ||
    c === '-' ||
    c === '_' ||
    c === ':'
  )
}

function isSpace(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\f'
}

function decode(text: string): string {
  return text
    .split('&lt;')
    .join('<')
    .split('&gt;')
    .join('>')
    .split('&quot;')
    .join('"')
    .split('&apos;')
    .join("'")
    .split('&nbsp;')
    .join('\u00a0')
    .split('&amp;')
    .join('&')
}

function isVoid(tag: string): boolean {
  return (
    tag === 'img' ||
    tag === 'link' ||
    tag === 'meta' ||
    tag === 'br' ||
    tag === 'hr' ||
    tag === 'input' ||
    tag === 'area' ||
    tag === 'base' ||
    tag === 'col' ||
    tag === 'embed' ||
    tag === 'param' ||
    tag === 'source' ||
    tag === 'track' ||
    tag === 'wbr'
  )
}

function renderHtml(source: string): void {
  const html = htmlRead(source)
  const lower = html.toLowerCase()
  const root = document.createElement('body')
  const nodes: Element[] = [root]
  const tags: string[] = ['body']
  let inHead = false
  let cursor = 0

  htmlBeginRules()
  while (cursor < html.length) {
    if (html.charAt(cursor) !== '<') {
      let end = html.indexOf('<', cursor)

      if (end < 0) {
        end = html.length
      }

      const text = html.slice(cursor, end)

      if (!inHead && (text.trim() !== '' || nodes.length > 1)) {
        nodes[nodes.length - 1].appendChild(document.createTextNode(decode(text)))
      }

      cursor = end
      continue
    }

    if (html.slice(cursor, cursor + 4) === '<!--') {
      const end = html.indexOf('-->', cursor + 4)

      if (end < 0) {
        htmlFail('Unclosed HTML comment at ' + String(cursor))
      }

      cursor = end + 3
      continue
    }

    if (lower.slice(cursor, cursor + 9) === '<!doctype') {
      const end = html.indexOf('>', cursor + 9)

      if (end < 0) {
        htmlFail('Unclosed doctype at ' + String(cursor))
      }

      cursor = end + 1
      continue
    }

    const closing = html.charAt(cursor + 1) === '/'

    cursor += closing ? 2 : 1
    const first = cursor

    while (nameChar(html.charAt(cursor))) {
      cursor++
    }

    if (first === cursor) {
      htmlFail('Expected a tag name at ' + String(cursor))
    }

    const tag = lower.slice(first, cursor)

    if (closing) {
      while (isSpace(html.charAt(cursor))) {
        cursor++
      }

      if (html.charAt(cursor) !== '>') {
        htmlFail('Invalid closing tag at ' + String(cursor))
      }

      cursor++
      if (tag === 'head') {
        inHead = false
      } else if (tag !== 'html' && tag !== 'body') {
        if (tags.length < 2 || tag !== tags[tags.length - 1]) {
          htmlFail('Unexpected closing tag: ' + tag)
        }

        tags.pop()
        nodes.pop()
      }

      continue
    }

    if (tag === 'script' || tag === 'base' || tag === 'iframe') {
      htmlFail('Unsupported HTML element: ' + tag)
    }

    const container = tag === 'html' || tag === 'head' || tag === 'body'
    const visible =
      !container &&
      !inHead &&
      tag !== 'style' &&
      tag !== 'link' &&
      tag !== 'meta' &&
      tag !== 'title'
    const element = visible ? document.createElement(tag) : root
    let href = ''
    let rel = ''
    let selfClosing: boolean

    while (true) {
      while (isSpace(html.charAt(cursor))) {
        cursor++
      }

      const c = html.charAt(cursor)

      if (c === '>' || (c === '/' && html.charAt(cursor + 1) === '>')) {
        selfClosing = c === '/'
        cursor += selfClosing ? 2 : 1
        break
      }

      const begin = cursor

      while (nameChar(html.charAt(cursor))) {
        cursor++
      }

      if (cursor === begin) {
        htmlFail('Invalid attribute at ' + String(cursor))
      }

      const key = lower.slice(begin, cursor)

      while (isSpace(html.charAt(cursor))) {
        cursor++
      }

      let value = ''

      if (html.charAt(cursor) === '=') {
        cursor++
        while (isSpace(html.charAt(cursor))) {
          cursor++
        }

        const quote = html.charAt(cursor)

        if (quote === '"' || quote === "'") {
          const end = html.indexOf(quote, cursor + 1)

          if (end < 0) {
            htmlFail('Unclosed attribute at ' + String(cursor))
          }

          value = html.slice(cursor + 1, end)
          cursor = end + 1
        } else {
          const start = cursor

          while (
            cursor < html.length &&
            !isSpace(html.charAt(cursor)) &&
            html.charAt(cursor) !== '>'
          ) {
            cursor++
          }

          value = html.slice(start, cursor)
        }
      }

      value = decode(value)
      if (key === 'href') {
        href = value
      }

      if (key === 'rel') {
        rel = value.toLowerCase()
      }

      if ((visible || tag === 'body') && key.slice(0, 2) !== 'on') {
        if (key === 'src' && tag === 'img') {
          value = htmlResolve(source, value)
        }

        if (key === 'style') {
          registerInline(element, value)
        } else {
          element.setAttribute(key, value)
        }
      }
    }

    if (tag === 'head') {
      inHead = true
    }

    if (tag === 'style' || tag === 'title') {
      const endTag = '</' + tag + '>'
      const end = lower.indexOf(endTag, cursor)

      if (end < 0) {
        htmlFail('Unclosed ' + tag)
      }

      if (tag === 'style') {
        registerCss(html.slice(cursor, end), source)
      }

      cursor = end + endTag.length
    } else if (tag === 'link' && rel === 'stylesheet') {
      const path = htmlResolve(source, href)

      registerCss(htmlRead(path), path)
    } else if (visible) {
      nodes[nodes.length - 1].appendChild(element)
      if (!selfClosing && !isVoid(tag)) {
        tags.push(tag)
        nodes.push(element)
      }
    }
  }

  if (tags.length !== 1) {
    htmlFail('Unclosed element: ' + tags[tags.length - 1])
  }

  htmlEndRules()
  htmlMount(root)
}

renderHtml(htmlInput())
