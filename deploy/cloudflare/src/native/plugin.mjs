import { inertPluginInstance } from '@geastack/compiler/plugin'

const functions = [
  'capturePng',
  'preparePage',
  'abortPage',
  'finishPage',
  'startCaptureMetrics',
  'finishCaptureMetrics',
  'captureMetrics',
  'captureTotalMemory',
  'httpPrerenderMode',
  'openBundle',
  'beginFileBundle',
  'writeBundleFile',
  'finishFileBundle',
  'discardFileBundle',
  'benchmarkFixturesEnabled',
  'htmlSetAssetRoot',
]

export default {
  name: 'html-renderer-http-host',
  instantiate() {
    return {
      ...inertPluginInstance,
      capabilities: {
        ...inertPluginInstance.capabilities,
        hostFunctions: new Map(functions.map((name) => [name, name])),
        hostPreambles: new Map(
          functions.map((name) => [name, ['#include "prerender-http.h"', '#include "bundle.h"']]),
        ),
      },
    }
  },
}
