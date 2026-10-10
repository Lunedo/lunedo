import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatLoadSummary, readingOf, type Sample, sampleBetween } from "./vm-load.ts";

const meminfo = "MemTotal:       16384000 kB\nMemFree:         1000000 kB\nMemAvailable:    4096000 kB\n";

function procStat(cpu: number[], running: number): string {
  return [
    `cpu  ${cpu.join(" ")} 0 0`,
    "cpu0 1 1 1 1 1 1 1 1 0 0",
    "cpu1 1 1 1 1 1 1 1 1 0 0",
    "intr 0",
    `procs_running ${running}`,
    "procs_blocked 0",
  ].join("\n");
}

function sample(overrides: Partial<Sample>): Sample {
  return {
    at: "2026-10-10T12:00:05.000Z",
    cores: 10,
    busyPercent: 50,
    iowaitPercent: 0,
    stealPercent: 0,
    runnable: 4,
    memoryUsedMiB: 8192,
    memoryTotalMiB: 16000,
    ...overrides,
  };
}

describe("readingOf", () => {
  it("reads the CPU times, cores, runnable processes and memory", () => {
    const reading = readingOf(
      new Date("2026-10-10T12:00:00Z"),
      procStat([10, 2, 8, 70, 5, 1, 1, 3], 7),
      meminfo,
    );
    assert.deepEqual(reading, {
      at: "2026-10-10T12:00:00.000Z",
      cpu: { total: 100, idle: 70, iowait: 5, steal: 3 },
      cores: 2,
      runnable: 7,
      memoryTotalKiB: 16384000,
      memoryAvailableKiB: 4096000,
    });
  });

  it("refuses input without a CPU line or memory values", () => {
    assert.throws(() => readingOf(new Date(), "intr 0", meminfo), /no cpu line/);
    assert.throws(() => readingOf(new Date(), procStat([1, 1, 1, 1], 1), "MemTotal: 1 kB\n"), /MemAvailable/);
  });
});

describe("sampleBetween", () => {
  it("computes the shares of the time between two readings", () => {
    const at = new Date("2026-10-10T12:00:00Z");
    const previous = readingOf(at, procStat([100, 0, 100, 700, 50, 0, 0, 50], 1), meminfo);
    const next = readingOf(
      new Date(at.getTime() + 5000),
      procStat([700, 0, 200, 800, 150, 0, 0, 150], 9),
      meminfo,
    );
    assert.deepEqual(sampleBetween(previous, next), {
      at: "2026-10-10T12:00:05.000Z",
      cores: 2,
      busyPercent: 70,
      iowaitPercent: 10,
      stealPercent: 10,
      runnable: 9,
      memoryUsedMiB: 12000,
      memoryTotalMiB: 16000,
    });
  });

  it("reports no load when no CPU time passed", () => {
    const reading = readingOf(new Date(), procStat([1, 1, 1, 1], 1), meminfo);
    const result = sampleBetween(reading, reading);
    assert.equal(result.busyPercent, 0);
    assert.equal(result.iowaitPercent, 0);
  });
});

describe("formatLoadSummary", () => {
  it("shows average, 95th percentile and maximum and lists every sample", () => {
    const samples = Array.from({ length: 20 }, (_, index) =>
      sample({
        busyPercent: (index + 1) * 5,
        runnable: index + 1,
        at: `2026-10-10T12:00:${String(index).padStart(2, "0")}.000Z`,
      }),
    );
    const summary = formatLoadSummary("the end-to-end tests", samples, 5);
    assert.match(summary, /^### VM load during the end-to-end tests\n/);
    assert.match(summary, /20 samples every 5 s over 1\.7 min, 10 vCPUs, 15\.6 GiB memory\./);
    assert.match(summary, /\| CPU busy \| 52\.5 % \| 95\.0 % \| 100\.0 % \|/);
    assert.match(summary, /\| Runnable processes \| 10\.5 \| 19\.0 \| 20\.0 \|/);
    assert.match(summary, /\| Memory used \| 8\.0 GiB \| 8\.0 GiB \| 8\.0 GiB \|/);
    assert.match(summary, /\| 12:00:19 \| 100\.0 % \| 0\.0 % \| 0\.0 % \| 20 \| 8\.0 GiB \|/);
    assert.equal(summary.match(/^\| 12:00:/gm)?.length, 20);
  });

  it("says so when nothing was recorded", () => {
    assert.equal(
      formatLoadSummary("the tests", [], 5),
      "### VM load during the tests\n\nNo samples were recorded.\n",
    );
  });
});
