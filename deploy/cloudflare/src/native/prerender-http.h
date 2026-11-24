// SPDX-License-Identifier: Apache-2.0
#pragma once

#include "metrics.h"

#include <cstdint>
#include <vector>

bool httpPrerenderMode();
void preparePage();
void abortPage();
void finishPage();
std::vector<std::uint8_t> capturePng();
