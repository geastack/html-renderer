import { inertPluginInstance } from '@geastack/compiler/plugin'

const functions = [
  'htmlVideo',
  'htmlInput',
  'htmlRead',
  'htmlResolve',
  'htmlRule',
  'htmlKeyframe',
  'htmlBeginRules',
  'htmlEndRules',
  'htmlFont',
  'htmlFail',
  'htmlMarkText',
  'htmlMount',
  'htmlInline',
]

export default {
  name: 'html-renderer-host',
  instantiate() {
    return {
      ...inertPluginInstance,
      capabilities: {
        ...inertPluginInstance.capabilities,
        hostFunctions: new Map(functions.map((name) => [name, name])),
        hostPreambles: new Map(functions.map((name) => [name, ['#include "html_host.h"']])),
      },
    }
  },
}
