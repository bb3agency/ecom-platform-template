export interface MetricFamily {
  name: string;
  type: string;
  help: string;
  samples: string[];
}

/** Groups Prometheus exposition text into metric families (HELP/TYPE + their sample lines). */
export function parsePrometheusText(text: string): MetricFamily[] {
  const families = new Map<string, MetricFamily>();
  const family = (name: string): MetricFamily => {
    let entry = families.get(name);
    if (!entry) {
      entry = { name, type: "untyped", help: "", samples: [] };
      families.set(name, entry);
    }
    return entry;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const meta = /^# (HELP|TYPE) (\S+) ?(.*)$/.exec(line);
    if (meta) {
      const entry = family(meta[2] ?? "");
      if (meta[1] === "HELP") entry.help = meta[3] ?? "";
      else entry.type = meta[3] ?? "untyped";
      continue;
    }
    if (line.startsWith("#")) continue;
    const sampleName = /^[a-zA-Z_:][a-zA-Z0-9_:]*/.exec(line)?.[0];
    if (!sampleName) continue;
    // Histogram/summary samples (_bucket/_sum/_count) belong to their declared base family.
    const base = sampleName.replace(/_(bucket|sum|count|created)$/, "");
    const target = families.has(sampleName) ? sampleName : families.has(base) ? base : sampleName;
    family(target).samples.push(line);
  }
  return [...families.values()].sort((a, b) => a.name.localeCompare(b.name));
}
