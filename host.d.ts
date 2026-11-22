declare function htmlInput(): string
declare function htmlRead(path: string): string
declare function htmlResolve(source: string, relative: string): string
declare function htmlRule(selector: string, property: string, value: string): void
declare function htmlBeginRules(): void
declare function htmlEndRules(): void
declare function htmlFont(family: string, path: string): void
declare function htmlFail(message: string): void
declare function htmlMount(root: import('@geastack/core').Element): void
declare function htmlInline(element: import('@geastack/core').Element, property: string, value: string): void
