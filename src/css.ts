import type { Element } from '@geastack/core'

export function registerInline(element: Element, css: string): void {
  for (const declaration of css.split(';')) {
    if (declaration.trim() === '') {
      continue
    }

    const colon = declaration.indexOf(':')

    if (colon < 0) {
      htmlFail('Expected an inline CSS declaration')
    }

    htmlInline(element, declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim())
  }
}

// The engine owns property parsing and the cascade. This reader only splits
// rule blocks, extracts local font resources, and forwards declarations.
function unquote(value: string): string {
  const first = value.charAt(0)

  if ((first === '"' || first === "'") && value.charAt(value.length - 1) === first) {
    return value.slice(1, -1)
  }

  return value
}

export function registerCss(input: string, source: string): void {
  let css = input
  let comment = css.indexOf('/*')

  while (comment >= 0) {
    const end = css.indexOf('*/', comment + 2)

    if (end < 0) {
      htmlFail('Unclosed CSS comment in ' + source)
    }

    css = css.slice(0, comment) + ' ' + css.slice(end + 2)
    comment = css.indexOf('/*', comment)
  }

  let start = 0

  while (start < css.length) {
    const open = css.indexOf('{', start)

    if (open < 0) {
      if (css.slice(start).trim() !== '') {
        htmlFail('Expected a CSS rule in ' + source)
      }

      return
    }

    const close = css.indexOf('}', open + 1)

    if (close < 0) {
      htmlFail('Unclosed CSS rule in ' + source)
    }

    const selector = css.slice(start, open).trim()
    const font = selector === '@font-face'

    if (selector.charAt(0) === '@' && !font) {
      htmlFail('Unsupported CSS at-rule: ' + selector)
    }

    const selectors = selector.split(',')
    const declarations = css.slice(open + 1, close).split(';')
    let family = ''
    let fontPath = ''

    for (const declaration of declarations) {
      if (declaration.trim() === '') {
        continue
      }

      const colon = declaration.indexOf(':')

      if (colon < 0) {
        htmlFail('Expected a CSS declaration in ' + source)
      }

      const property = declaration.slice(0, colon).trim()
      const value = declaration.slice(colon + 1).trim()

      if (font) {
        if (property === 'font-family') {
          family = unquote(value)
        }

        if (property === 'src') {
          if (value.slice(0, 4) !== 'url(') {
            htmlFail('Expected a local font URL in ' + source)
          }

          const end = value.indexOf(')', 4)

          if (end < 0) {
            htmlFail('Unclosed font URL in ' + source)
          }

          fontPath = htmlResolve(source, unquote(value.slice(4, end).trim()))
        }
      } else {
        for (const item of selectors) {
          const name = item.trim()

          if (name === '') {
            htmlFail('Empty CSS selector in ' + source)
          }

          htmlRule(name, property, value)
        }
      }
    }

    if (font) {
      if (family === '' || fontPath === '') {
        htmlFail('Incomplete @font-face in ' + source)
      }

      htmlFont(family, fontPath)
    }

    start = close + 1
  }
}
