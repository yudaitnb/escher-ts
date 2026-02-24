import type { BenchmarkRunReport } from "./harness.js";

const esc = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export const benchmarkReportToCsv = (report: BenchmarkRunReport): string => {
  const header = "category,name,success,elapsed_ms,cost,depth,reboots";
  const rows = report.cases.map((row) =>
    [row.category, row.name, row.success ? "true" : "false", row.elapsedMs, row.cost ?? "", row.depth ?? "", row.reboots ?? ""].join(","),
  );
  return [header, ...rows].join("\n");
};

export const benchmarkReportToSvg = (report: BenchmarkRunReport): string => {
  const height = 560;
  const marginLeft = 96;
  const marginRight = 30;
  const marginTop = 50;
  const marginBottom = 210;

  const categoryOrder = ["lists", "integers", "trees", "classes"] as const;
  const groups = categoryOrder
    .map((category) => ({ category, rows: report.cases.filter((c) => c.category === category) }))
    .filter((g) => g.rows.length > 0);
  const categoryTitle = (category: (typeof categoryOrder)[number]): string => {
    switch (category) {
      case "lists":
        return "Lists";
      case "integers":
        return "Integers";
      case "trees":
        return "Trees";
      case "classes":
        return "Classes";
    }
  };

  const maxElapsed = Math.max(1, ...report.cases.map((c) => c.elapsedMs));
  const categoryGapUnits = 0.9;
  const unitCount = report.cases.length + Math.max(0, groups.length - 1) * categoryGapUnits;
  const minBarArea = 38;
  const width = Math.max(1100, Math.ceil(marginLeft + marginRight + unitCount * minBarArea));
  const chartWidth = width - marginLeft - marginRight;
  const chartHeight = height - marginTop - marginBottom;
  const barArea = chartWidth / Math.max(1, unitCount);
  const barWidth = Math.max(8, Math.min(48, barArea * 0.7));

  const bars: string[] = [];
  const labels: string[] = [];
  const valueLabels: string[] = [];
  const groupLabels: string[] = [];
  const separators: string[] = [];
  let cursor = 0;
  for (const [groupIdx, group] of groups.entries()) {
    const groupStart = cursor;
    for (const row of group.rows) {
      const x = marginLeft + cursor * barArea + (barArea - barWidth) / 2;
      const h = (row.elapsedMs / maxElapsed) * chartHeight;
      const y = marginTop + chartHeight - h;
      const color = row.success ? "#2f7d32" : "#b42318";
      bars.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${h.toFixed(2)}" fill="${color}" />`);

      const lx = marginLeft + cursor * barArea + barArea / 2;
      const labelY = marginTop + chartHeight + 18;
      const name = esc(row.name);
      labels.push(`<text x="${lx.toFixed(2)}" y="${labelY.toFixed(2)}" text-anchor="middle" font-size="10" transform="rotate(55 ${lx.toFixed(2)} ${labelY.toFixed(2)})">${name}</text>`);

      const vy = marginTop + chartHeight - h - 6;
      valueLabels.push(`<text x="${lx.toFixed(2)}" y="${Math.max(14, vy).toFixed(2)}" text-anchor="middle" font-size="10">${row.elapsedMs}ms</text>`);
      cursor += 1;
    }
    const groupEnd = cursor;
    const gx = marginLeft + ((groupStart + groupEnd) / 2) * barArea;
    const groupLabelY = marginTop + chartHeight + 128;
    groupLabels.push(`<text x="${gx.toFixed(2)}" y="${groupLabelY.toFixed(2)}" text-anchor="middle" font-size="12" font-weight="600">${categoryTitle(group.category)}</text>`);
    if (groupIdx < groups.length - 1) {
      const sx = marginLeft + cursor * barArea + (categoryGapUnits * barArea) / 2;
      separators.push(`<line x1="${sx.toFixed(2)}" y1="${marginTop}" x2="${sx.toFixed(2)}" y2="${(marginTop + chartHeight).toFixed(2)}" stroke="#d1d5db" stroke-dasharray="4 4" />`);
      cursor += categoryGapUnits;
    }
  }

  const yTicks = [0, 0.25, 0.5, 0.75, 1]
    .map((p) => {
      const y = marginTop + chartHeight - p * chartHeight;
      const v = Math.round(maxElapsed * p);
      return `
<line x1="${marginLeft}" y1="${y.toFixed(2)}" x2="${width - marginRight}" y2="${y.toFixed(2)}" stroke="#e5e7eb" />
<text x="${marginLeft - 12}" y="${(y + 11).toFixed(2)}" text-anchor="end" font-size="10">${v}</text>`;
    })
    .join("\n");
  const engineLabel = report.engine === "typed-escher" ? "TypedEscher" : "AscendRec";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff" />
  <text x="${width / 2}" y="28" text-anchor="middle" font-size="18" font-family="sans-serif">${engineLabel} Benchmark Runtime</text>
  <text x="${width / 2}" y="46" text-anchor="middle" font-size="12" font-family="sans-serif">${report.succeeded}/${report.total} succeeded, total ${report.durationMs} ms</text>
  ${yTicks}
  <line x1="${marginLeft}" y1="${marginTop + chartHeight}" x2="${width - marginRight}" y2="${marginTop + chartHeight}" stroke="#111827" />
  ${groupLabels.join("\n")}
  ${separators.join("\n")}
  ${bars.join("\n")}
  ${valueLabels.join("\n")}
  ${labels.join("\n")}
</svg>`;
};
