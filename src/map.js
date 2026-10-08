// Choropleth: median household income or median gross rent by NYC ZCTA.

// Classification: quintiles of the EXACT estimates for each metric (computed
// separately; top-coded lower bounds are excluded), rounded to readable values.
// Each class holds roughly a fifth of ZCTAs with exact estimates:
//   income quintiles  $62,471 / $81,084 / $94,585 / $122,552 -> rounded to $5k
//   rent quintiles    $1,600 / $1,768 / $1,975 / $2,345      -> rounded to $50
// Top-coded values ($250,000+, $3,500+) are above every break, so they fall in
// the highest class.
const METRICS = {
  income: {
    label: "Median household income",
    breaks: [60000, 80000, 95000, 125000],
    short: v => `$${v / 1000}k`,
    topcodeNote: "incl. $250,000+",
  },
  rent: {
    label: "Median gross rent",
    breaks: [1600, 1750, 1950, 2350],
    short: d3.format("$,"),
    topcodeNote: "incl. $3,500+",
  },
};

// One sequential hue (light -> dark), matching the scatterplot's blue.
const COLORS = ["#dde7f0", "#a8c1d9", "#7099bf", "#41709d", "#1b4470"];
const NO_ESTIMATE = "url(#no-estimate-hatch)";

const fmtDollars = d3.format("$,.0f");
const formatEstimate = (value, topcoded) =>
  value === null ? "No estimate" : fmtDollars(value) + (topcoded ? "+" : "");

let metric = "income";

const colorScale = () => d3.scaleThreshold().domain(METRICS[metric].breaks).range(COLORS);

function fillFor(props) {
  const v = props[metric];
  return v === null ? NO_ESTIMATE : colorScale()(v);
}

// On touch screens, one-finger dragging would trap normal page scrolling, so it
// is turned off there; the zoom buttons and pinch-zoom still work.
const isTouch = L.Browser.mobile || window.matchMedia("(pointer: coarse)").matches;

const map = L.map("map", {
  scrollWheelZoom: false, // don't hijack page scrolling
  dragging: !isTouch,
  zoomSnap: 0.25,
  attributionControl: true,
});

// OpenStreetMap tiles (attribution required, no API key), desaturated and faded
// in CSS (.basemap) so the basemap stays quiet behind the choropleth.
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  className: "basemap",
  opacity: 0.55, // set here, not in CSS: Leaflet writes opacity inline on the tile layer
  maxZoom: 18,
}).addTo(map);

d3.json("data/processed/nyc_rent_income.geojson").then(geojson => {
  const baseStyle = { color: "#fff", weight: 0.6, opacity: 1, fillOpacity: 0.9 };

  // Only one ZCTA is highlighted at a time. Touch taps never fire mouseout, so
  // the previous highlight/tooltip is cleared explicitly.
  let active = null;
  function activate(lyr, latlng) {
    if (active && active !== lyr) deactivate();
    active = lyr;
    lyr.setStyle({ color: "#1a1a1a", weight: 1.5 });
    lyr.bringToFront();
    if (latlng) lyr.openTooltip(latlng);
  }
  function deactivate() {
    if (!active) return;
    active.setStyle({ color: "#fff", weight: 0.6 });
    active.closeTooltip();
    active = null;
  }

  const layer = L.geoJSON(geojson, {
    style: f => ({ ...baseStyle, fillColor: fillFor(f.properties) }),
    onEachFeature: (feature, lyr) => {
      lyr.bindTooltip(() => tooltipHTML(feature.properties), { sticky: true, className: "map-tooltip" });
      lyr.on({
        mouseover: () => activate(lyr),
        mouseout: deactivate,
        click: e => activate(lyr, e.latlng), // touch devices have no hover
      });
    },
  }).addTo(map);

  // Fit to the data itself rather than a hardcoded center/zoom.
  map.fitBounds(layer.getBounds(), { padding: [8, 8] });
  new ResizeObserver(() => {
    map.invalidateSize();
    map.fitBounds(layer.getBounds(), { padding: [8, 8] });
  }).observe(document.getElementById("map"));

  addHatchPattern();

  // Income | Rent toggle
  const buttons = document.querySelectorAll(".metric-toggle button");
  buttons.forEach(btn => btn.addEventListener("click", () => {
    metric = btn.dataset.metric;
    buttons.forEach(b => b.setAttribute("aria-pressed", b === btn));
    layer.setStyle(f => ({ fillColor: fillFor(f.properties) }));
    renderLegend();
  }));

  renderLegend();
});

function tooltipHTML(p) {
  // Both values are shown; the selected metric is listed first and bolded.
  const lines = ["income", "rent"].map(k => {
    const text = `${METRICS[k].label}: ${formatEstimate(p[k], p[`${k}_topcoded`])}`;
    return k === metric ? `<strong>${text}</strong>` : `<span class="secondary">${text}</span>`;
  });
  if (metric === "rent") lines.reverse();
  return `<div class="zcta">ZIP code ${p.zcta}</div>${lines.join("<br>")}`;
}

function renderLegend() {
  const m = METRICS[metric];
  const b = m.breaks;
  const labels = [
    `Under ${m.short(b[0])}`,
    ...d3.pairs(b).map(([lo, hi]) => `${m.short(lo)}–${m.short(hi)}`),
    `${m.short(b[b.length - 1])}+ (${m.topcodeNote})`,
  ];
  const items = COLORS.map((c, i) => ({ swatch: `background:${c}`, label: labels[i] }));
  items.push({ swatch: "", hatch: true, label: "No estimate" });

  const legend = document.getElementById("map-legend");
  legend.setAttribute("aria-label", `${m.label} legend`);
  legend.innerHTML = `<div class="legend-title">${m.label}</div><ul>` +
    items.map(it => `<li><span class="swatch${it.hatch ? " hatch" : ""}" style="${it.swatch}"></span>${it.label}</li>`).join("") +
    "</ul>";
}

// "No estimate" uses diagonal hatching as well as a neutral gray, so it is not
// distinguished by color alone. The pattern lives in Leaflet's SVG overlay.
function addHatchPattern() {
  const svg = map.getPanes().overlayPane.querySelector("svg");
  const defs = d3.select(svg).insert("defs", ":first-child");
  const pattern = defs.append("pattern")
    .attr("id", "no-estimate-hatch").attr("patternUnits", "userSpaceOnUse")
    .attr("width", 6).attr("height", 6).attr("patternTransform", "rotate(45)");
  pattern.append("rect").attr("width", 6).attr("height", 6).attr("fill", "#ecebe7");
  pattern.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 6)
    .attr("stroke", "#a8a59d").attr("stroke-width", 1.5);
}
