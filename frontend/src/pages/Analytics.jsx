import React, { useEffect, useMemo, useState } from "react";
import { apiGet } from "../lib/api.js";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend
} from "recharts";

function formatTwo(v) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n.toFixed(2) : String(v ?? 0);
}

function moneyFmt(v) {
  const n = Number(v || 0);
  return Number.isFinite(n)
    ? n.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })
    : String(v ?? 0);
}

function MetricCard({ title, value, subtitle, money = false }) {
  return (
    <div className="kv">
      <div className="k">{title}</div>
      <div className="v">
        {money ? (
          <span className="moneyCell">
            <span>{moneyFmt(value)}</span>
            <img
              src="/sar.svg"
              alt="SAR"
              className="moneyIcon"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          </span>
        ) : (
          value
        )}
      </div>
      {subtitle ? <div className="small" style={{ marginTop: 6 }}>{subtitle}</div> : null}
    </div>
  );
}

function safetyLabel(temp, humidity) {
  if (temp == null || humidity == null) return "--";
  if (temp >= 40 || humidity >= 85) return "Unsafe";
  if (temp >= 35 || humidity >= 70) return "Caution";
  return "Safe";
}

function qualityLabel(tds, turbidity) {
  if (tds == null || turbidity == null) return "--";
  if (tds > 500 || turbidity > 700) return "Bad";
  return "Good";
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;

  const isLight =
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "light";

  const statusItem = payload.find((p) => p.dataKey === "statusValue");
  const statusLabel = statusItem?.payload?.status || null;

  return (
    <div
      style={{
        padding: 10,
        borderRadius: 12,
        border: isLight ? "1px solid rgba(31,36,48,0.18)" : "1px solid rgba(255,255,255,0.10)",
        background: isLight ? "rgba(255,255,255,0.98)" : "rgba(15,19,32,0.95)",
        color: isLight ? "#1f2430" : "#e8eef6",
        boxShadow: isLight ? "0 8px 24px rgba(31,36,48,0.12)" : "0 8px 24px rgba(0,0,0,0.25)"
      }}
    >
      <div className="small" style={{ color: isLight ? "#5f6778" : undefined }}>
        {label}
      </div>

      {statusLabel ? (
        <div style={{ fontWeight: 900, marginTop: 4 }}>
          Quality: {statusLabel}
        </div>
      ) : null}

      {payload
        .filter((p) => p.dataKey !== "statusValue")
        .map((p, idx) => (
          <div key={idx} style={{ fontWeight: 800 }}>
            {p.name}: {formatTwo(p.value)}{p.unit ? ` ${p.unit}` : ""}
          </div>
        ))}
    </div>
  );
}

function ZoomModal({ open, title, children, onClose }) {
  if (!open) return null;

  return (
    <div className="modalBackdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="hrow">
          <div style={{ fontSize: 18, fontWeight: 900 }}>{title}</div>
          <button onClick={onClose}>Close</button>
        </div>
        <div className="zoomChartArea" style={{ height: 520, marginTop: 12 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

export default function Analytics() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [summary, setSummary] = useState(null);
  const [monthly, setMonthly] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [zoom, setZoom] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      setErr("");
      try {
        const [sum, mo] = await Promise.all([
          apiGet(`/api/analytics/summary?year=${year}`),
          apiGet(`/api/analytics/monthly?year=${year}`)
        ]);
        setSummary(sum);
        setMonthly(mo?.items || []);
      } catch (e) {
        setErr(String(e?.message || e));
        setSummary(null);
        setMonthly([]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [year]);

  const qualityLine = useMemo(
    () =>
      (monthly || []).map((m) => ({
        month: m.month_name || m.month,
        tds: Number(m.avg_tds_ppm || 0),
        turbidity: Number(m.avg_turbidity_ntu || 0),
        status: qualityLabel(m.avg_tds_ppm, m.avg_turbidity_ntu),
        statusValue: Number(m.avg_tds_ppm || 0)
      })),
    [monthly]
  );

  const opsBars = useMemo(
    () =>
      (monthly || []).map((m) => ({
        month: m.month_name || m.month,
        current: Number(m.total_water_l || 0),
        baseline: Number(summary?.operations?.baseline_water_l || 0)
      })),
    [monthly, summary?.operations?.baseline_water_l]
  );

  const latestQuality = qualityLabel(
    summary?.water_quality?.latest_tds_ppm,
    summary?.water_quality?.latest_turbidity_ntu
  );

  return (
    <div className="card">
      <div className="hrow wrap">
        <div>
          <div style={{ fontSize: 22, fontWeight: 900 }}>Analytics</div>
          <div className="small">
            Water quality, operations, environment, revenue and credit overview.
          </div>
        </div>
        <div style={{ minWidth: 180 }}>
          <div className="small">Year</div>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value || new Date().getFullYear()))}
          />
        </div>
      </div>

      {loading ? <div className="small" style={{ marginTop: 12 }}>Loading…</div> : null}
      {err ? <div style={{ marginTop: 12, color: "rgba(239,68,68,0.95)" }}>{err}</div> : null}

      <div className="hr" />

      <div className="analyticsGrid">
        <MetricCard
          title="Revenue"
          value={summary?.revenue?.total_revenue_sar ?? 0}
          subtitle={`ARPU: ${moneyFmt(summary?.revenue?.arpu_sar ?? 0)} SAR`}
          money
        />
        <MetricCard
          title="Water Quality"
          value={latestQuality}
          subtitle={`TDS ${formatTwo(summary?.water_quality?.latest_tds_ppm ?? 0)} ppm / Turbidity ${formatTwo(summary?.water_quality?.latest_turbidity_ntu ?? 0)} NTU`}
        />
        <MetricCard
          title="Operations"
          value={`${formatTwo(summary?.operations?.avg_water_flow_per_cycle_l ?? 0)} L`}
          subtitle="Water flow per wash cycle"
        />
        <MetricCard
          title="Environment"
          value={safetyLabel(
            summary?.environment?.avg_env_temperature_c,
            summary?.environment?.avg_env_humidity_pct
          )}
          subtitle={`Temp ${formatTwo(summary?.environment?.avg_env_temperature_c ?? 0)} °C / Humidity ${formatTwo(summary?.environment?.avg_env_humidity_pct ?? 0)} %`}
        />
        <MetricCard
          title="Total Credit"
          value={summary?.credit?.total_credit_sar ?? 0}
          subtitle={`Avg budget/user ${moneyFmt(summary?.credit?.avg_budget_per_user_sar ?? 0)} SAR`}
          money
        />
      </div>

      <div className="hr" />

      <div className="chartGrid">
        <div className="kv" style={{ padding: 12 }}>
          <div className="hrow" style={{ marginBottom: 8 }}>
            <div style={{ fontWeight: 900 }}>Water Quality</div>
            <button onClick={() => setZoom("quality")} style={{ padding: "6px 10px", borderRadius: 10 }}>
              Zoom
            </button>
          </div>

          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={qualityLine} margin={{ top: 10, right: 18, left: 10, bottom: 52 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="month"
                  height={50}
                  tick={{ fontSize: 11 }}
                  label={{ value: "Month", position: "insideBottom", offset: -2 }}
                />
                <YAxis
                  label={{ value: "Quality Reading", angle: -90, position: "insideLeft" }}
                />
                <Tooltip content={<ChartTooltip />} />
                <Legend verticalAlign="top" height={28} wrapperStyle={{ paddingBottom: 8 }} />
                <Line
                  type="monotone"
                  dataKey="tds"
                  name="TDS"
                  unit="ppm"
                  dot={false}
                  stroke="#22c55e"
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="turbidity"
                  name="Turbidity"
                  unit="NTU"
                  dot={false}
                  stroke="#ef4444"
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="statusValue"
                  name="Quality Status"
                  stroke="transparent"
                  dot={false}
                  activeDot={false}
                  legendType="none"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="kv" style={{ padding: 12 }}>
          <div className="hrow" style={{ marginBottom: 8 }}>
            <div style={{ fontWeight: 900 }}>Water Flow per Wash Cycle</div>
            <button onClick={() => setZoom("ops")} style={{ padding: "6px 10px", borderRadius: 10 }}>
              Zoom
            </button>
          </div>

          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={opsBars} margin={{ top: 10, right: 18, left: 10, bottom: 52 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="month"
                  height={50}
                  tick={{ fontSize: 11 }}
                  label={{ value: "Month", position: "insideBottom", offset: -2 }}
                />
                <YAxis
                  label={{ value: "Water Volume (L)", angle: -90, position: "insideLeft" }}
                />
                <Tooltip content={<ChartTooltip />} />
                <Legend verticalAlign="top" height={28} wrapperStyle={{ paddingBottom: 8 }} />
                <Bar dataKey="current" name="Current" unit="L" />
                <Bar dataKey="baseline" name="Baseline" unit="L" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <ZoomModal
        open={zoom === "quality"}
        title="Water Quality"
        onClose={() => setZoom("")}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={qualityLine} margin={{ top: 10, right: 18, left: 10, bottom: 58 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="month"
              height={52}
              tick={{ fontSize: 11 }}
              label={{ value: "Month", position: "insideBottom", offset: -2 }}
            />
            <YAxis
              label={{ value: "Quality Reading", angle: -90, position: "insideLeft" }}
            />
            <Tooltip content={<ChartTooltip />} />
            <Legend verticalAlign="top" height={30} wrapperStyle={{ paddingBottom: 10 }} />
            <Line
              type="monotone"
              dataKey="tds"
              name="TDS"
              unit="ppm"
              dot={false}
              stroke="#22c55e"
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="turbidity"
              name="Turbidity"
              unit="NTU"
              dot={false}
              stroke="#ef4444"
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="statusValue"
              name="Quality Status"
              stroke="transparent"
              dot={false}
              activeDot={false}
              legendType="none"
            />
          </LineChart>
        </ResponsiveContainer>
      </ZoomModal>

      <ZoomModal
        open={zoom === "ops"}
        title="Water Flow per Wash Cycle"
        onClose={() => setZoom("")}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={opsBars} margin={{ top: 10, right: 18, left: 10, bottom: 58 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="month"
              height={52}
              tick={{ fontSize: 11 }}
              label={{ value: "Month", position: "insideBottom", offset: -2 }}
            />
            <YAxis
              label={{ value: "Water Volume (L)", angle: -90, position: "insideLeft" }}
            />
            <Tooltip content={<ChartTooltip />} />
            <Legend verticalAlign="top" height={30} wrapperStyle={{ paddingBottom: 10 }} />
            <Bar dataKey="current" name="Current" unit="L" />
            <Bar dataKey="baseline" name="Baseline" unit="L" />
          </BarChart>
        </ResponsiveContainer>
      </ZoomModal>
    </div>
  );
}