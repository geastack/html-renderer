// SPDX-License-Identifier: Apache-2.0
#pragma once

#include "metrics.h"

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

// The renderer owns the bytes until the next capture.
std::size_t rpios_capture_http_png(const char *input, bool reuse, const char **bytes);

static std::vector<std::uint8_t> capturePng(const std::string &input, bool reuse)
{
	CaptureMetrics metrics;
	const char *bytes = nullptr;
	const auto size = rpios_capture_http_png(input.c_str(), reuse, &bytes);
	std::vector<std::uint8_t> png;
	if (size != 0) png.assign(bytes, bytes + size);
	metrics.finish();

	return png;
}
