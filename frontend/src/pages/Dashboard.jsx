import React, { useEffect, useMemo, useState } from "react";
import { useWsSensors } from "../hooks/useWsSensors.js";
import { apiGet, apiHistory, apiPost } from "../lib/api.js";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend
} from "recharts";

const DASHBOARD_SECTIONS = [
  { key: "home", label: "Home" },
  { key: "last-report", label: "Last Report" },
  { key: "service-type", label: "Service Type" },
  { key: "revenue-consumption", label: "Revenue & Consumption" },
  { key: "system-data", label: "System Data" }
];

const RANGES = [
  ["1h", "1 hour"],
  ["12h", "12 hours"],
  ["1d", "Day"],
  ["1w", "Week"],
  ["1m", "Month"],
  ["1y", "Year"]
];

const METRICS = [
  ["total_air_l", "Total air flow volume (mission)"],
  ["total_water_l", "Total water flow volume (mission)"],
  ["avg_env_temperature_c", "Average environment temperature (mission)"],
  ["avg_env_humidity_pct", "Average environment humidity (mission)"],
  ["avg_water_temperature_c", "Average water temperature (mission)"],
  ["avg_tds_ppm", "Average total dissolved solids (mission)"],
  ["avg_turbidity_ntu", "Average turbidity (mission)"],
  ["samples", "Number of samples (mission)"]
];

const SERVICE_OPTIONS = [
  { value: "OUT_WASH", label: "Outside Service" },
  { value: "IN_OUT_WASH", label: "In/Out Service" },
  { value: "IN_OUT_WASH_POLISH", label: "In/Out & Polish Service" }
];

function fmtVal(v, unit) {
  if (v === null || v === undefined || Number.isNaN(v)) return "--";
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(n)) return String(v);
  const s =
    Math.abs(n) >= 100 ? n.toFixed(0) :
    Math.abs(n) >= 10 ? n.toFixed(1) :
    n.toFixed(2);
  return unit ? `${s} ${unit}` : s;
}

function fmtMoney(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "--";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString("en-US");
}

function getMetricObj(stationObj, metric) {
  const m = stationObj?.[metric];
  if (!m) return null;
  if (typeof m === "object" && "value" in m) return m;
  return null;
}

function formatUID(uid) {
  if (!uid) return "--";
  const clean = String(uid).replace(/\s+/g, "").toUpperCase();
  return clean.match(/.{1,2}/g)?.join(" ") || uid;
}

function formatPlate(d, l) {
  if (!d && !l) return "--";
  return `${d || ""} ${l || ""}`.trim();
}

function SmallMoney({ value }) {
  return (
    <span className="moneyCell">
      <span>{fmtMoney(value)}</span>
      <img
        src="/sar.svg"
        alt="SAR"
        className="moneyIcon"
        onError={(e) => { e.currentTarget.style.display = "none"; }}
      />
    </span>
  );
}

function getMetricMeta(metricKey, title) {
  const map = {
    total_air_l: {
      unit: "L",
      shortName: "Air Flow",
      yAxisLabel: "Air Volume (L)"
    },
    total_water_l: {
      unit: "L",
      shortName: "Water Flow",
      yAxisLabel: "Water Volume (L)"
    },
    avg_env_temperature_c: {
      unit: "°C",
      shortName: "Env Temperature",
      yAxisLabel: "Temperature (°C)"
    },
    avg_env_humidity_pct: {
      unit: "%",
      shortName: "Env Humidity",
      yAxisLabel: "Humidity (%)"
    },
    avg_water_temperature_c: {
      unit: "°C",
      shortName: "Water Temperature",
      yAxisLabel: "Temperature (°C)"
    },
    avg_tds_ppm: {
      unit: "ppm",
      shortName: "TDS",
      yAxisLabel: "TDS (ppm)"
    },
    avg_turbidity_ntu: {
      unit: "NTU",
      shortName: "Turbidity",
      yAxisLabel: "Turbidity (NTU)"
    },
    samples: {
      unit: "",
      shortName: "Samples",
      yAxisLabel: "Samples"
    }
  };

  return map[metricKey] || {
    unit: "",
    shortName: title || metricKey,
    yAxisLabel: "Value"
  };
}

function formatChartTick(ts, rangeKey) {
  const d = new Date(ts * 1000);
  if (Number.isNaN(d.getTime())) return "";

  if (rangeKey === "1h" || rangeKey === "12h") {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  if (rangeKey === "1d") {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  if (rangeKey === "1w") {
    return d.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  if (rangeKey === "1m" || rangeKey === "1y") {
    return d.toLocaleDateString([], {
      month: "short",
      day: "numeric"
    });
  }

  return d.toLocaleString();
}

function formatTooltipLabel(ts) {
  const d = new Date(ts * 1000);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;

  const isLight =
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "light";

  const first = payload[0] || {};
  const rawValue = first.value;
  const value = typeof rawValue === "number" ? rawValue : Number(rawValue);
  const unit = first?.unit || first?.payload?.unit || "";
  const metricName = first?.name || first?.payload?.seriesName || "Value";

  return (
    <div
      style={{
        padding: 10,
        borderRadius: 12,
        border: isLight ? "1px solid rgba(31,36,48,0.18)" : "1px solid rgba(255,255,255,0.10)",
        background: isLight ? "rgba(255,255,255,0.98)" : "rgba(15,19,32,0.95)",
        color: isLight ? "#1f2430" : "#e8eef6",
        boxShadow: isLight ? "0 8px 24px rgba(31,36,48,0.12)" : "0 8px 24px rgba(0,0,0,0.25)",
        minWidth: 180
      }}
    >
      <div className="small" style={{ color: isLight ? "#5f6778" : "#aab4c3" }}>
        {formatTooltipLabel(label)}
      </div>
      <div style={{ fontWeight: 900, marginTop: 6 }}>{metricName}</div>
      <div style={{ marginTop: 4, fontSize: 15, fontWeight: 800 }}>
        {fmtVal(value, unit)}
      </div>
    </div>
  );
}

function DashboardSidebar({ section, setSection, station, stations, setStation, connected }) {
  return (
    <div className="sideNav">
      <div className="sideNavTitle">Dashboard</div>

      <div className="sideNavGroup">
        {DASHBOARD_SECTIONS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`sideNavBtn ${section === item.key ? "active" : ""}`}
            onClick={() => setSection(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="hr" />

      <div className={`badge ${connected ? "ok" : "bad"}`}>
        {connected ? "Connected" : "Disconnected"}
      </div>

      <div className="panel stationCard">
        <div className="small">Station</div>
        <div className="stationValue">{station || "--"}</div>
        <div style={{ marginTop: 10 }}>
          <select value={station} onChange={(e) => setStation(e.target.value)}>
            {stations.length === 0 ? <option value="">(no stations yet)</option> : null}
            {stations.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}

function ChartCard({ metricKey, title, points, onZoom, rangeKey }) {
  const meta = getMetricMeta(metricKey, title);

  const data = useMemo(
    () =>
      (points || []).map((p) => ({
        ts: Number(p.ts),
        y: Number(p.value ?? 0),
        unit: meta.unit,
        seriesName: meta.shortName
      })),
    [points, meta.unit, meta.shortName]
  );

  return (
    <div className="kv chartCardWrap" style={{ padding: 12 }}>
      <div className="hrow">
        <div style={{ fontWeight: 900 }}>{title}</div>
        <button onClick={onZoom} style={{ padding: "6px 10px", borderRadius: 10 }}>Zoom</button>
      </div>

      <div className="chartArea" style={{ height: 300, marginTop: 8 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 16, right: 18, left: 12, bottom: 56 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="ts"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(value) => formatChartTick(value, rangeKey)}
              tick={{ fontSize: 10, fill: "var(--text)" }}
              minTickGap={10}
              interval="preserveStartEnd"
              height={54}
              label={{
                value: "Time",
                position: "insideBottom",
                offset: -4,
                fill: "var(--text)"
              }}
            />
            <YAxis
              width={68}
              tick={{ fontSize: 10, fill: "var(--text)" }}
              label={{
                value: meta.yAxisLabel,
                angle: -90,
                position: "insideLeft",
                fill: "var(--text)"
              }}
            />
            <Tooltip content={<ChartTooltip />} />
            <Legend wrapperStyle={{ color: "var(--text)" }} verticalAlign="top" height={28} />
            <Line
              type="monotone"
              dataKey="y"
              name={meta.shortName}
              unit={meta.unit}
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="small">{data.length} points</div>
    </div>
  );
}

function HomeView({ station, stations }) {
  const [rangeKey, setRangeKey] = useState("12h");
  const [series, setSeries] = useState({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [zoom, setZoom] = useState(null);

  useEffect(() => {
    async function load() {
      if (!station) return;
      setLoading(true);
      setErr("");
      try {
        const out = {};
        await Promise.all(METRICS.map(async ([m]) => {
          const res = await apiHistory(station, m, rangeKey);
          out[m] = res.points || [];
        }));
        setSeries(out);
      } catch (e) {
        setErr(String(e?.message || e));
        setSeries({});
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [station, rangeKey]);

  return (
    <div className="card">
      <div className="hrow wrap">
        <div>
          <div style={{ fontSize: 22, fontWeight: 900 }}>Home</div>
          <div className="small">History charts that were previously under Reports.</div>
        </div>
        <div style={{ minWidth: 200 }}>
          <div className="small">Time range</div>
          <select value={rangeKey} onChange={(e) => setRangeKey(e.target.value)}>
            {RANGES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </div>
      </div>

      {!station && stations.length === 0 ? (
        <div className="emptyState" style={{ marginTop: 14 }}>No station data available yet.</div>
      ) : null}

      {err ? <div style={{ marginTop: 12, color: "rgba(239,68,68,0.95)" }}>{err}</div> : null}
      {loading ? <div className="small" style={{ marginTop: 12 }}>Loading…</div> : null}

      <div className="hr" />

      <div className="chartGrid">
        {METRICS.map(([m, title]) => (
          <ChartCard
            key={m}
            metricKey={m}
            title={title}
            points={series[m] || []}
            rangeKey={rangeKey}
            onZoom={() => setZoom({ metricKey: m, title, points: series[m] || [], rangeKey })}
          />
        ))}
      </div>

      {zoom ? (
        <div className="modalBackdrop" onClick={() => setZoom(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="hrow">
              <div style={{ fontSize: 18, fontWeight: 900 }}>{zoom.title}</div>
              <button onClick={() => setZoom(null)}>Close</button>
            </div>

            <div className="zoomChartArea" style={{ height: 500, marginTop: 12 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={(zoom.points || []).map((p) => ({
                    ts: Number(p.ts),
                    y: Number(p.value ?? 0),
                    unit: getMetricMeta(zoom.metricKey, zoom.title).unit,
                    seriesName: getMetricMeta(zoom.metricKey, zoom.title).shortName
                  }))}
                  margin={{ top: 16, right: 24, left: 20, bottom: 56 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="ts"
                    type="number"
                    domain={["dataMin", "dataMax"]}
                    tickFormatter={(value) => formatChartTick(value, zoom.rangeKey)}
                    tick={{ fontSize: 11, fill: "var(--text)" }}
                    minTickGap={16}
                    interval="preserveStartEnd"
                    height={54}
                    label={{
                      value: "Time",
                      position: "insideBottom",
                      offset: -4,
                      fill: "var(--text)"
                    }}
                  />
                  <YAxis
                    width={76}
                    tick={{ fontSize: 11, fill: "var(--text)" }}
                    label={{
                      value: getMetricMeta(zoom.metricKey, zoom.title).yAxisLabel,
                      angle: -90,
                      position: "insideLeft",
                      fill: "var(--text)"
                    }}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ color: "var(--text)" }} verticalAlign="top" height={32} />
                  <Line
                    type="monotone"
                    dataKey="y"
                    name={getMetricMeta(zoom.metricKey, zoom.title).shortName}
                    unit={getMetricMeta(zoom.metricKey, zoom.title).unit}
                    dot={false}
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="small">{(zoom.points || []).length} points</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LastReportView({ stationObj }) {
  const mission = stationObj?.mission_summary || null;
  const [user, setUser] = useState(null);
  const [loadingUser, setLoadingUser] = useState(false);

  useEffect(() => {
    async function fetchUser() {
      if (!mission?.uid) {
        setUser(null);
        return;
      }
      setLoadingUser(true);
      try {
        const res = await apiGet(`/api/users/search?q=${encodeURIComponent(mission.uid)}&by=uid`);
        if (res?.items && res.items.length > 0) setUser(res.items[0]);
        else setUser(null);
      } catch (e) {
        console.error(e);
        setUser(null);
      } finally {
        setLoadingUser(false);
      }
    }
    fetchUser();
  }, [mission?.uid]);

  const airTotalLive = getMetricObj(stationObj, "air_total_l");
  const waterTotalLive = getMetricObj(stationObj, "water_total_l");

  const airTotal = mission ? mission.total_air_l : airTotalLive?.value;
  const waterTotal = mission ? mission.total_water_l : waterTotalLive?.value;

  return (
    <div className="card">
      <div style={{ fontSize: 22, fontWeight: 900 }}>Last Report</div>
      <div className="small" style={{ marginTop: 6 }}>Latest mission and totals.</div>
      <div className="hr" />
      <div style={{ fontWeight: 900, marginBottom: 8 }}>User Information</div>
      <div className="kvgrid">
        <div className="kv"><div className="k">UID</div><div className="v">{formatUID(mission?.uid)}</div></div>
        <div className="kv"><div className="k">Request ID</div><div className="v">{mission?.req_id || "--"}</div></div>
        <div className="kv"><div className="k">Name</div><div className="v">{loadingUser ? "Loading..." : user?.name || "--"}</div></div>
        <div className="kv"><div className="k">Car Plate</div><div className="v">{loadingUser ? "Loading..." : formatPlate(user?.plate_digits, user?.plate_letters)}</div></div>
      </div>
      <div className="hr" />
      <div style={{ fontWeight: 900, marginBottom: 8 }}>Total measurements</div>
      <div className="kvgrid">
        <div className="kv"><div className="k">Total air flow volume</div><div className="v">{fmtVal(airTotal, "L")}</div></div>
        <div className="kv"><div className="k">Total water flow volume</div><div className="v">{fmtVal(waterTotal, "L")}</div></div>
      </div>
      <div className="hr" />
      <div style={{ fontWeight: 900, marginBottom: 8 }}>Last Mission Data</div>
      <div className="kvgrid">
        <div className="kv"><div className="k">Average environment temperature</div><div className="v">{fmtVal(mission?.avg_env_temperature_c, "°C")}</div></div>
        <div className="kv"><div className="k">Average environment humidity</div><div className="v">{fmtVal(mission?.avg_env_humidity_pct, "%")}</div></div>
        <div className="kv"><div className="k">Average water temperature</div><div className="v">{fmtVal(mission?.avg_water_temperature_c, "°C")}</div></div>
        <div className="kv"><div className="k">Average total dissolved solids</div><div className="v">{fmtVal(mission?.avg_tds_ppm, "ppm")}</div></div>
        <div className="kv"><div className="k">Average turbidity</div><div className="v">{fmtVal(mission?.avg_turbidity_ntu, "NTU")}</div></div>
        <div className="kv"><div className="k">Number of samples</div><div className="v">{fmtVal(mission?.samples, "")}</div></div>
      </div>
    </div>
  );
}

function RevenueConsumptionView({ station }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [overview, setOverview] = useState(null);
  const [monthly, setMonthly] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      setErr("");
      try {
        const [ov, mo] = await Promise.all([
          apiGet(`/api/analytics/overview?year=${year}${station ? `&station=${encodeURIComponent(station)}` : ""}`),
          apiGet(`/api/analytics/monthly?year=${year}${station ? `&station=${encodeURIComponent(station)}` : ""}`)
        ]);
        setOverview(ov);
        setMonthly(mo?.items || []);
      } catch (e) {
        setErr(String(e?.message || e));
        setOverview(null);
        setMonthly([]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [year, station]);

  const cards = [
    ["Total Revenue", overview?.totals?.revenue_sar, "sar"],
    ["Total Water Consumption", overview?.totals?.total_water_l, "L"],
    ["Total Air Consumption", overview?.totals?.total_air_l, "L"],
    ["Average TDS", overview?.totals?.avg_tds_ppm, "ppm"],
    ["Average Turbidity", overview?.totals?.avg_turbidity_ntu, "NTU"],
    ["Average Env Temperature", overview?.totals?.avg_env_temperature_c, "°C"],
    ["Average Env Humidity", overview?.totals?.avg_env_humidity_pct, "%"],
    ["Average Water Temperature", overview?.totals?.avg_water_temperature_c, "°C"],
    ["Visits", overview?.totals?.visits_count, ""],
    ["Missions", overview?.totals?.missions_count, ""]
  ];

  return (
    <div className="card">
      <div className="hrow wrap">
        <div>
          <div style={{ fontSize: 22, fontWeight: 900 }}>Revenue & Consumption</div>
          <div className="small">Yearly totals, averages, and monthly breakdown.</div>
        </div>
        <div style={{ minWidth: 180 }}>
          <div className="small">Year</div>
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value || new Date().getFullYear()))} />
        </div>
      </div>

      {loading ? <div className="small" style={{ marginTop: 12 }}>Loading…</div> : null}
      {err ? <div style={{ marginTop: 12, color: "rgba(239,68,68,0.95)" }}>{err}</div> : null}

      <div className="hr" />

      <div className="kvgrid">
        {cards.map(([label, value, unit]) => (
          <div className="kv" key={label}>
            <div className="k">{label}</div>
            <div className="v">{unit === "sar" ? <SmallMoney value={value || 0} /> : fmtVal(value, unit)}</div>
          </div>
        ))}
      </div>

      <div className="hr" />
      <div style={{ fontWeight: 900, marginBottom: 10 }}>Monthly Revenue & Consumption</div>
      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Month</th>
              <th>Revenue (SAR)</th>
              <th>Visits</th>
              <th>Missions</th>
              <th>Water (L)</th>
              <th>Air (L)</th>
              <th>Avg TDS</th>
              <th>Avg Turbidity</th>
            </tr>
          </thead>
          <tbody>
            {monthly.map((item) => (
              <tr key={item.month}>
                <td>{item.month_name || item.month}</td>
                <td><SmallMoney value={item.revenue_sar || 0} /></td>
                <td>{item.visits_count || 0}</td>
                <td>{item.missions_count || 0}</td>
                <td>{fmtVal(item.total_water_l, "L")}</td>
                <td>{fmtVal(item.total_air_l, "L")}</td>
                <td>{fmtVal(item.avg_tds_ppm, "ppm")}</td>
                <td>{fmtVal(item.avg_turbidity_ntu, "NTU")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ServiceTypeView({ station, selectedService, savingService, setService, servicesError, discounts, saveDiscount, savingDiscount }) {
  return (
    <div className="card">
      <div style={{ fontSize: 22, fontWeight: 900 }}>Service Type</div>
      <div className="small" style={{ marginTop: 6 }}>Service selection and discount controls for the current station.</div>
      {servicesError ? <div className="small" style={{ color: "rgba(239,68,68,0.95)", marginTop: 10 }}>API: {servicesError}</div> : null}
      <div className="hr" />
      <div className="row">
        <div className="kv"><div className="k">Station</div><div className="v">{station || "--"}</div></div>
        <div className="kv"><div className="k">Selected service</div><div className="v" style={{ fontSize: 18 }}>{SERVICE_OPTIONS.find((s) => s.value === selectedService)?.label || selectedService || "--"}</div></div>
      </div>
      <div className="hr" />
      <div className="small" style={{ marginBottom: 10 }}>Change service:</div>
      <div className="serviceCardGrid">
        {SERVICE_OPTIONS.map((opt) => {
          const discount = discounts?.[opt.value] || { enabled: false, discount_pct: 0 };
          const isSelected = opt.value === selectedService;
          return (
            <button
              key={opt.value}
              type="button"
              className={`serviceSelectCard ${isSelected ? 'selected' : ''}`}
              disabled={!station || savingService || savingDiscount === opt.value}
              onClick={async () => {
                await saveDiscount(opt.value, Number(discount.discount_pct || 0) > 0, discount.discount_pct);
                await setService(opt.value);
              }}
            >
              <div className="serviceSelectCardHeader">
                <div>
                  <div style={{ fontWeight: 900, fontSize: 18 }}>{opt.label}</div>
                  <div className="small">Click to select and apply discount automatically.</div>
                </div>
                <span className="serviceBadge">{isSelected ? 'Selected' : 'Press'}</span>
              </div>
              <div className="hr" />
              <div>
                <div className="small">Discount percentage</div>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={discount.discount_pct ?? 0}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => saveDiscount(opt.value, Number(e.target.value || 0) > 0, e.target.value, true)}
                  style={{ marginTop: 8, width: 110 }}
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SystemDataView({ stationObj }) {
  return (
    <div className="card">
      <div style={{ fontSize: 22, fontWeight: 900 }}>System Data</div>
      <div className="small" style={{ marginTop: 6 }}>Raw JSON from the station snapshot.</div>
      <div className="hr" />
      <pre>{JSON.stringify(stationObj || {}, null, 2)}</pre>
    </div>
  );
}

export default function Dashboard() {
  const { connected, snapshot, stations, lastError } = useWsSensors();

  const [section, setSection] = useState("home");
  const [station, setStation] = useState("");
  const [services, setServices] = useState({ default: "OUT_WASH", services: {}, prices: {}, discounts: {} });
  const [savingDiscount, setSavingDiscount] = useState("");
  const [servicesError, setServicesError] = useState("");
  const [savingService, setSavingService] = useState(false);

  useEffect(() => {
    if (!station && stations.length) setStation(stations[0]);
  }, [stations, station]);

  async function refreshServices() {
    try {
      const data = await apiGet("/api/stations/services");
      setServices(data);
      setServicesError("");
    } catch (e) {
      setServicesError(String(e?.message || e));
    }
  }

  useEffect(() => {
    refreshServices();
  }, []);

  const selectedService = useMemo(() => {
    if (!station) return services.default || "OUT_WASH";
    return (services.services && services.services[station]) || services.default || "OUT_WASH";
  }, [services, station]);

  async function saveDiscount(service, enabled, discountPct, localOnly = false) {
    const pct = Number(discountPct || 0);
    setServices((prev) => ({
      ...prev,
      discounts: {
        ...(prev.discounts || {}),
        [service]: { enabled: !!enabled, discount_pct: pct }
      }
    }));
    if (localOnly) return;
    setSavingDiscount(service);
    try {
      await apiPost(`/api/services/${service}/discount`, { enabled: !!enabled, discount_pct: pct });
      await refreshServices();
    } catch (e) {
      setServices((prev) => prev);
      setServicesError(String(e?.message || e));
    } finally {
      setSavingDiscount("");
    }
  }

  async function setService(svc) {
    if (!station || savingService) return;
    const prev = services;
    setSavingService(true);
    setServices({ ...services, services: { ...(services.services || {}), [station]: svc } });
    try {
      await apiPost(`/api/stations/${encodeURIComponent(station)}/service`, { service: svc });
      await refreshServices();
    } catch (e) {
      setServices(prev);
      setServicesError(String(e?.message || e));
    } finally {
      setSavingService(false);
    }
  }

  const stationObj = station ? snapshot?.[station] : null;

  let content = null;
  if (section === "home") content = <HomeView station={station} stations={stations} />;
  if (section === "last-report") content = <LastReportView stationObj={stationObj} />;
  if (section === "service-type") content = <ServiceTypeView station={station} selectedService={selectedService} savingService={savingService} setService={setService} servicesError={servicesError} discounts={services.discounts || {}} saveDiscount={saveDiscount} savingDiscount={savingDiscount} />;
  if (section === "revenue-consumption") content = <RevenueConsumptionView station={station} />;
  if (section === "system-data") content = <SystemDataView stationObj={stationObj} />;

  return (
    <div className="pageShell">
      <DashboardSidebar section={section} setSection={setSection} station={station} stations={stations} setStation={setStation} connected={connected} />
      <div>
        {lastError ? (
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="small" style={{ color: "rgba(239,68,68,0.95)" }}>
              WS: {lastError}
            </div>
          </div>
        ) : null}
        {content}
      </div>
    </div>
  );
}
