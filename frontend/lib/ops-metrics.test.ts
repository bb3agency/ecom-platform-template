import { describe, expect, it } from "vitest";
import { parsePrometheusText } from "./ops-metrics";

const SAMPLE = `# HELP http_requests_total Requests served.
# TYPE http_requests_total counter
http_requests_total{route="/a"} 3
http_requests_total{route="/b"} 5

# HELP latency_seconds Request latency.
# TYPE latency_seconds histogram
latency_seconds_bucket{le="0.1"} 2
latency_seconds_sum 0.4
latency_seconds_count 7
orphan_metric 1
`;

describe("parsePrometheusText", () => {
  it("groups samples under their HELP/TYPE family, histograms included", () => {
    const families = parsePrometheusText(SAMPLE);
    expect(families.map((f) => f.name)).toEqual(["http_requests_total", "latency_seconds", "orphan_metric"]);
    const counter = families[0];
    expect(counter?.type).toBe("counter");
    expect(counter?.help).toBe("Requests served.");
    expect(counter?.samples).toHaveLength(2);
    expect(families[1]?.samples).toEqual([
      'latency_seconds_bucket{le="0.1"} 2',
      "latency_seconds_sum 0.4",
      "latency_seconds_count 7",
    ]);
    expect(families[2]).toMatchObject({ type: "untyped", help: "", samples: ["orphan_metric 1"] });
  });

  it("returns nothing for an empty snapshot", () => {
    expect(parsePrometheusText("\n\n")).toEqual([]);
  });
});
