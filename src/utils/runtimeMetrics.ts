interface RuntimeMetrics {
  signalsScanned: number;
  signalsAccepted: number;
  startedAt: string;
}

const metrics: RuntimeMetrics = {
  signalsScanned: 0,
  signalsAccepted: 0,
  startedAt: new Date().toISOString(),
};

export function recordSignalScanned(count = 1): void {
  metrics.signalsScanned += count;
}

export function recordSignalAccepted(): void {
  metrics.signalsAccepted += 1;
}

export function getRuntimeMetrics(): RuntimeMetrics {
  return { ...metrics };
}
