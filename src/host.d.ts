import type { Element, Node } from '@geastack/core'

declare global {
  function htmlVideo(node: Node, document: string, media: string): void
  function htmlInput(): string
  function htmlRead(path: string): string
  function htmlResolve(source: string, relative: string): string
  function htmlRule(selector: string, property: string, value: string): void
  function htmlKeyframe(name: string, offset: number, property: string, value: string): void
  function htmlBeginRules(): void
  function htmlEndRules(): void
  function htmlFont(family: string, path: string): void
  function htmlFail(message: string): void
  function htmlMarkText(node: Node): void
  function htmlMount(root: Element): void
  function htmlInline(element: Element, property: string, value: string): void
}
