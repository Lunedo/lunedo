export interface CpuTimes {
  total: number;
  idle: number;
  iowait: number;
  steal: number;
}

export interface Reading {
  at: string;
  cpu: CpuTimes;
  cores: number;
  runnable: number;
  memoryTotalKiB: number;
  memoryAvailableKiB: number;
}

export interface Sample {
  at: string;
  cores: number;
  busyPercent: number;
  iowaitPercent: number;
  stealPercent: number;
  runnable: number;
  memoryUsedMiB: number;
  memoryTotalMiB: number;
}

function fieldsOf(line: string): number[] {
  return line.trim().split(/\s+/).slice(1).map(Number);
}

export function readingOf(at: Date, procStat: string, meminfo: string): Reading {
  const lines = procStat.split("\n");
  const cpuLine = lines.find((line) => line.startsWith("cpu "));
  if (!cpuLine) throw new Error("/proc/stat has no cpu line");
  const [user = 0, nice = 0, system = 0, idle = 0, iowait = 0, irq = 0, softirq = 0, steal = 0] =
    fieldsOf(cpuLine);
  const runnableLine = lines.find((line) => line.startsWith("procs_running "));
  const memory = (key: string) => {
    const match = new RegExp(`^${key}:\\s+(\\d+) kB`, "m").exec(meminfo);
    if (!match?.[1]) throw new Error(`/proc/meminfo has no ${key}`);
    return Number(match[1]);
  };
  return {
    at: at.toISOString(),
    cpu: { total: user + nice + system + idle + iowait + irq + softirq + steal, idle, iowait, steal },
    cores: lines.filter((line) => /^cpu\d+ /.test(line)).length,
    runnable: runnableLine ? (fieldsOf(runnableLine)[0] ?? 0) : 0,
    memoryTotalKiB: memory("MemTotal"),
    memoryAvailableKiB: memory("MemAvailable"),
  };
}

function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

export function sampleBetween(previous: Reading, next: Reading): Sample {
  const total = next.cpu.total - previous.cpu.total;
  const idle = next.cpu.idle - previous.cpu.idle;
  const iowait = next.cpu.iowait - previous.cpu.iowait;
  const steal = next.cpu.steal - previous.cpu.steal;
  return {
    at: next.at,
    cores: next.cores,
    busyPercent: percent(total - idle - iowait - steal, total),
    iowaitPercent: percent(iowait, total),
    stealPercent: percent(steal, total),
    runnable: next.runnable,
    memoryUsedMiB: Math.round((next.memoryTotalKiB - next.memoryAvailableKiB) / 1024),
    memoryTotalMiB: Math.round(next.memoryTotalKiB / 1024),
  };
}

function statistics(values: number[]): { average: number; p95: number; maximum: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
  return { average, p95, maximum: sorted[sorted.length - 1] ?? 0 };
}

function gib(mebibytes: number): string {
  return `${(mebibytes / 1024).toFixed(1)} GiB`;
}

export function formatLoadSummary(
  title: string,
  samples: readonly Sample[],
  intervalSeconds: number,
): string {
  const heading = `### VM load during ${title}\n\n`;
  if (samples.length === 0) return `${heading}No samples were recorded.\n`;
  const first = samples[0] as Sample;
  const minutes = (samples.length * intervalSeconds) / 60;
  const row = (name: string, values: number[], format: (value: number) => string) => {
    const { average, p95, maximum } = statistics(values);
    return `| ${name} | ${format(average)} | ${format(p95)} | ${format(maximum)} |`;
  };
  const share = (value: number) => `${value.toFixed(1)} %`;
  const lines = [
    `${samples.length} samples every ${intervalSeconds} s over ${minutes.toFixed(1)} min, ${first.cores} vCPUs, ${gib(first.memoryTotalMiB)} memory.`,
    "",
    "| | Average | 95th percentile | Maximum |",
    "|---|---|---|---|",
    row(
      "CPU busy",
      samples.map((sample) => sample.busyPercent),
      share,
    ),
    row(
      "I/O wait",
      samples.map((sample) => sample.iowaitPercent),
      share,
    ),
    row(
      "Steal",
      samples.map((sample) => sample.stealPercent),
      share,
    ),
    row(
      "Runnable processes",
      samples.map((sample) => sample.runnable),
      (value) => value.toFixed(1),
    ),
    row(
      "Memory used",
      samples.map((sample) => sample.memoryUsedMiB),
      gib,
    ),
    "",
    "<details><summary>All samples</summary>",
    "",
    "| Time (UTC) | CPU busy | I/O wait | Steal | Runnable | Memory used |",
    "|---|---|---|---|---|---|",
    ...samples.map(
      (sample) =>
        `| ${sample.at.slice(11, 19)} | ${share(sample.busyPercent)} | ${share(sample.iowaitPercent)} | ${share(sample.stealPercent)} | ${sample.runnable} | ${gib(sample.memoryUsedMiB)} |`,
    ),
    "",
    "</details>",
  ];
  return `${heading}${lines.join("\n")}\n`;
}
