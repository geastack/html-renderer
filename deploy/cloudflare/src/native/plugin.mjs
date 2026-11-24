import { inertPluginInstance } from '@geastack/compiler/plugin'

export default {
  name: 'html-renderer-http-host',
  instantiate() {
    return {
      ...inertPluginInstance,
      capabilities: {
        ...inertPluginInstance.capabilities,
        hostFunctions: new Map([
          ['capturePng', 'capturePng'],
          ['captureMetrics', 'captureMetrics'],
        ]),
        hostPreambles: new Map([
          ['capturePng', ['#include "capture.h"']],
          ['captureMetrics', ['#include "capture.h"']],
        ]),
      },
    }
  },
}
