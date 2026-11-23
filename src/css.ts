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

function registerKeyframes(css: string, start: number, name: string): number {
  while (start < css.length) {
    const open = css.indexOf('{', start)
    const close = css.indexOf('}', start)

    if (close < 0) {
      break
    }

    if (open < 0 || close < open) {
      if (css.slice(start, close).trim() !== '') {
        htmlFail('Expected a keyframe block for ' + name)
      }

      return close + 1
    }

    for (const selector of css.slice(start, open).split(',')) {
      const offset = selector.trim().toLowerCase()
      let percent = 0

      if (offset === 'to') {
        percent = 100
      } else if (offset !== 'from') {
        if (offset.charAt(offset.length - 1) !== '%' || offset.slice(0, -1).trim() === '') {
          htmlFail('Invalid keyframe offset: ' + selector)
        }

        percent = Number(offset.slice(0, -1))
      }

      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        htmlFail('Invalid keyframe offset: ' + selector)
      }

      for (const declaration of css.slice(open + 1, close).split(';')) {
        if (declaration.trim() === '') {
          continue
        }

        const colon = declaration.indexOf(':')

        if (colon < 0) {
          htmlFail('Expected a keyframe declaration for ' + name)
        }

        htmlKeyframe(
          name,
          Math.round(percent * 10),
          declaration.slice(0, colon).trim(),
          declaration.slice(colon + 1).trim(),
        )
      }
    }

    start = close + 1
  }

  htmlFail('Unclosed @keyframes rule for ' + name)

  return css.length
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

    if (selector.slice(0, 10) === '@keyframes' && selector.charAt(10).trim() === '') {
      const name = selector.slice(10).trim()

      if (name === '') {
        htmlFail('Expected a keyframe name in ' + source)
      }

      start = registerKeyframes(css, open + 1, name)
      continue
    }

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
