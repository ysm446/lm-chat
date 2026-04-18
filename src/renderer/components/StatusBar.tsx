import { useEffect, useState } from "react";
import { SystemResources, fetchSystemResources } from "../api";

function statusBarColor(percent: number): string {
  if (percent < 50) return "#4a9eff";
  if (percent < 80) return "#e8814a";
  return "#e84a4a";
}

function formatPercent(value: number) {
  return `${Math.min(100, Math.max(0, value)).toFixed(0)}%`;
}

function formatGb(used: number, total: number) {
  return `${used.toFixed(1)} / ${total.toFixed(1)} GB`;
}

function MiniResourceBar({ label, percent, value }: { label: string; percent: number; value: string }) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className="statusbar-meter" title={`${label} ${value}`}>
      <span className="statusbar-meter-label">{label}</span>
      <div className="statusbar-meter-track">
        <div
          className="statusbar-meter-fill"
          style={{ width: `${clamped}%`, background: statusBarColor(clamped) }}
        />
      </div>
      <span className="statusbar-meter-value">{value}</span>
    </div>
  );
}

export function StatusBar() {
  const [showResources, setShowResources] = useState(false);
  const [resources, setResources] = useState<SystemResources | null>(null);

  useEffect(() => {
    const handleToggle = (event: Event) => {
      const customEvent = event as CustomEvent<{ enabled?: boolean }>;
      setShowResources(Boolean(customEvent.detail?.enabled));
    };
    window.addEventListener("lm-chat:statusbar-system-resources", handleToggle as EventListener);
    return () => {
      window.removeEventListener("lm-chat:statusbar-system-resources", handleToggle as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!showResources) {
      setResources(null);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const next = await fetchSystemResources();
        if (!cancelled) setResources(next);
      } catch {
        if (!cancelled) setResources(null);
      }
    };

    void load();
    const timer = window.setInterval(() => { void load(); }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [showResources]);

  const primaryGpu = resources?.gpus[0] ?? null;
  if (!showResources) return null;

  return (
    <footer className="statusbar">
      <div className="statusbar-right">
        {resources ? (
          <>
            <MiniResourceBar label="CPU" percent={resources.cpu_percent} value={formatPercent(resources.cpu_percent)} />
            <MiniResourceBar
              label="RAM"
              percent={resources.ram_percent}
              value={formatGb(resources.ram_used_gb, resources.ram_total_gb)}
            />
            {primaryGpu ? (
              <>
                <MiniResourceBar label="GPU" percent={primaryGpu.gpu_percent} value={formatPercent(primaryGpu.gpu_percent)} />
                <MiniResourceBar
                  label="VRAM"
                  percent={primaryGpu.vram_percent}
                  value={formatGb(primaryGpu.vram_used_gb, primaryGpu.vram_total_gb)}
                />
              </>
            ) : (
              <span className="statusbar-item dim">GPU: N/A</span>
            )}
          </>
        ) : (
          <span className="statusbar-item dim">Resources unavailable</span>
        )}
      </div>
    </footer>
  );
}
