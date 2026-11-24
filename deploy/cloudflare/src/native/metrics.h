// SPDX-License-Identifier: Apache-2.0
#pragma once

#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <fstream>
#include <mutex>
#include <optional>
#include <string>
#include <thread>

static std::int64_t cgroupCounter(const char *file, const char *first, const char *second = nullptr)
{
	std::ifstream stream(std::string("/sys/fs/cgroup/") + file);
	std::int64_t total = 0;
	std::int64_t value;
	std::string key;
	bool found = false;
	while (stream >> key >> value) {
		if (key == first || (second && key == second)) {
			found = true;
			total += value;
		}
	}

	return found ? total : -1;
}

static std::int64_t anonymousMemory()
{
	return cgroupCounter("memory.stat", "anon", "shmem");
}

static std::string lastCaptureMetrics;
static bool firstCapture = true;

class CaptureMetrics {
	const std::chrono::steady_clock::time_point start = std::chrono::steady_clock::now();
	const std::int64_t cpuBefore = cgroupCounter("cpu.stat", "usage_usec");
	const std::int64_t baseline = anonymousMemory();
	std::int64_t peak = baseline;
	std::mutex timerMutex;
	std::condition_variable_any timer;
	std::jthread sampler{[this](std::stop_token stop) {
		std::unique_lock lock(timerMutex);
		while (!stop.stop_requested()) {
			timer.wait_for(lock, stop, std::chrono::milliseconds(5), [] { return false; });
			if (!stop.stop_requested()) peak = std::max(peak, anonymousMemory());
		}
	}};

public:
	void finish()
	{
		const auto end = std::chrono::steady_clock::now();
		const auto cpuAfter = cgroupCounter("cpu.stat", "usage_usec");
		sampler.request_stop();
		sampler.join();
		peak = std::max(peak, anonymousMemory());
		const auto wall = std::chrono::duration_cast<std::chrono::microseconds>(end - start).count();
		lastCaptureMetrics = std::to_string(wall) + "," +
			std::to_string(cpuBefore < 0 ? -1 : cpuAfter - cpuBefore) + "," +
			std::to_string(baseline) + "," + std::to_string(peak) + "," +
			std::to_string(firstCapture ? cpuAfter : -1);
		firstCapture = false;
	}
};

static std::optional<CaptureMetrics> captureSample;

static void startCaptureMetrics()
{
	captureSample.emplace();
}

static void finishCaptureMetrics()
{
	captureSample->finish();
	captureSample.reset();
}

static std::string captureMetrics()
{
	return lastCaptureMetrics;
}
