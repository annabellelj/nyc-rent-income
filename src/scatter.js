// Scatterplot: median household income (x) vs. median gross rent (y), one mark per ZCTA.

const fmtDollars = d3.format("$,.0f");

// Census reports top-coded medians as e.g. "250,000+" / "3,500+". The CSV stores
// the lower bound plus a flag; never display the bound as if it were exact.
function formatEstimate(value, topcoded) {
  return fmtDollars(value) + (topcoded ? "+" : "");
}

// Ordinary least squares: rent = intercept + slope * income.
function leastSquares(rows) {
  const meanX = d3.mean(rows, d => d.income);
  const meanY = d3.mean(rows, d => d.rent);
  const slope = d3.sum(rows, d => (d.income - meanX) * (d.rent - meanY)) /
                d3.sum(rows, d => (d.income - meanX) ** 2);
  return { slope, intercept: meanY - slope * meanX, n: rows.length };
}

d3.csv("data/processed/nyc_rent_income.csv", d => ({
  zcta: d.zcta,
  income: d.income === "" ? null : +d.income,
  rent: d.rent === "" ? null : +d.rent,
  incomeTopcoded: d.income_topcoded === "True",
  rentTopcoded: d.rent_topcoded === "True",
})).then(rows => {
  // Missing estimates cannot be placed on either axis, so they are left out here
  // (they still appear on the map as "No estimate").
  const plotted = rows.filter(d => d.income !== null && d.rent !== null);
  const exact = plotted.filter(d => !d.incomeTopcoded && !d.rentTopcoded);
  const topcoded = plotted.filter(d => d.incomeTopcoded || d.rentTopcoded);

  // One mark per ZCTA for exact estimates. Top-coded ZCTAs that land on the
  // identical lower-bound coordinate share one mark instead of being jittered,
  // since jitter would suggest differences the data does not contain.
  const marks = exact.map(d => ({ income: d.income, rent: d.rent, members: [d], hollow: false }));
  for (const members of d3.group(topcoded, d => `${d.income},${d.rent}`).values()) {
    marks.push({ income: members[0].income, rent: members[0].rent, members, hollow: true });
  }

  // Trend line is fitted to exact estimates only; lower bounds are not observations.
  const fit = leastSquares(exact);

  const container = document.getElementById("scatter");
  const tooltip = d3.select(container).append("div").attr("class", "tooltip").attr("hidden", true);

  function draw() {
    const width = container.clientWidth;
    const narrow = width < 520;
    const height = Math.max(340, Math.min(540, width * 0.66));
    const margin = { top: 28, right: 12, bottom: 44, left: narrow ? 50 : 58 };

    // Axis ranges follow the data: exact incomes span
    // $24k–$186k with top-coded values at $250k+, exact rents $1,010–$3,433 with
    // top-coded values at $3,500+. Neither axis starts at zero; no ZCTA is near
    // zero and including it would compress the points into a corner.
    const x = d3.scaleLinear().domain([20000, 260000]).range([margin.left, width - margin.right]);
    const y = d3.scaleLinear().domain([900, 3700]).range([height - margin.bottom, margin.top]);

    d3.select(container).select("svg").remove();
    const svg = d3.select(container).insert("svg", ".tooltip")
      .attr("width", width)
      .attr("height", height)
      .attr("aria-labelledby", "scatter-title scatter-desc");
    svg.append("title").attr("id", "scatter-title").text("Median household income vs. median gross rent by NYC ZIP code area");
    svg.append("desc").attr("id", "scatter-desc")
      .text(`Scatterplot of ${exact.length} ZIP code areas with exact estimates and ${topcoded.length} with top-coded estimates. ` +
            `Highlighted: ZIP code 11429 (income $102,880, rent $1,649) and ZIP code 10044 (income $103,347, rent $3,327). ` +
            `Each point can be focused with the Tab key to read its values.`);

    // Axes: horizontal gridlines only (long y ticks); the x axis keeps its labels without gridlines.
    const xTicks = narrow ? [50000, 150000, 250000] : [50000, 100000, 150000, 200000, 250000];
    svg.append("g").attr("class", "axis")
      .attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).tickValues(xTicks).tickFormat(d => `$${d / 1000}k`)
        .tickSize(0).tickPadding(8));
    svg.append("g").attr("class", "axis")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).tickValues(d3.range(1000, 3501, 500)).tickFormat(fmtDollars)
        .tickSize(-(width - margin.left - margin.right)).tickPadding(6));

    svg.append("text").attr("class", "axis-label")
      .attr("x", width - margin.right).attr("y", height - 6).attr("text-anchor", "end")
      .text("Median household income →");
    svg.append("text").attr("class", "axis-label")
      .attr("x", margin.left).attr("y", margin.top - 14)
      .text("Median gross rent ↑");

    // Trend line, drawn only across the range of the exact incomes it was fitted to.
    const [x0, x1] = d3.extent(exact, d => d.income);
    svg.append("line").attr("class", "trend").attr("data-n", fit.n)
      .attr("x1", x(x0)).attr("y1", y(fit.intercept + fit.slope * x0))
      .attr("x2", x(x1)).attr("y2", y(fit.intercept + fit.slope * x1));
    svg.append("text").attr("class", "trend-label")
      .attr("x", x(x1) + 4).attr("y", y(fit.intercept + fit.slope * x1) + 4)
      .text("Trend");

    // Points: filled = exact, hollow = at least one top-coded value.
    const dots = svg.append("g").selectAll("circle")
      .data(marks)
      .join("circle")
      .attr("class", d => d.hollow ? "dot hollow" : "dot exact")
      .attr("cx", d => x(d.income))
      .attr("cy", d => y(d.rent))
      .attr("r", narrow ? 3.5 : 4.5)
      .attr("tabindex", 0)
      .attr("role", "img")
      .attr("aria-label", d => tooltipText(d).join(". "))
      .on("focus", (event, d) => show(d))
      .on("blur", hide);

    // Label the shared mark so it reads as several ZCTAs, not one.
    for (const m of marks.filter(m => m.members.length > 1)) {
      svg.append("text").attr("class", "group-label")
        .attr("x", x(m.income) - 8).attr("y", y(m.rent) - 8).attr("text-anchor", "end")
        .text(`${m.members.length} ZIP codes`);
    }

    // Editorial annotation: two ZCTAs with near-identical incomes
    // ($102,880 and $103,347) whose median rents differ by $1,678.
    const low = marks.find(m => m.members[0].zcta === "11429");
    const high = marks.find(m => m.members[0].zcta === "10044");
    const note = svg.append("g").attr("class", "annotation").attr("aria-hidden", "true");
    for (const m of [low, high]) {
      note.append("circle").attr("cx", x(m.income)).attr("cy", y(m.rent)).attr("r", narrow ? 6.5 : 7.5);
    }
    // The note sits left of the two highlighted points, in the empty area below the $3,000 gridline.
    // On narrow screens it starts just below the $3,000 tick label so it can't collide with it.
    const noteLines = narrow ? ["Similar incomes,", "rents nearly", "$1,700 apart"]
                             : ["Similar incomes,", "rents nearly $1,700 apart"];
    note.append("text")
      .attr("class", "annotation-note").attr("text-anchor", "end")
      .style("font-size", narrow ? "11px" : null)
      .attr("x", x(high.income) - 10).attr("y", narrow ? y(3000) + 16 : y(2850))
      .selectAll("tspan").data(noteLines).join("tspan")
      .attr("x", x(high.income) - 10).attr("dy", (d, i) => i ? "1.25em" : 0).text(d => d);
    note.append("text")
      .attr("x", x(high.income) - 12).attr("y", y(high.rent) + 4).attr("text-anchor", "end")
      .text(`${narrow ? "" : "ZIP code "}10044: ${fmtDollars(high.rent)}`);
    note.append("text")
      .attr("x", x(low.income)).attr("y", y(low.rent) + 22).attr("text-anchor", "middle")
      .text(`${narrow ? "" : "ZIP code "}11429: ${fmtDollars(low.rent)}`);

    // Pointer hover snaps to the nearest mark (Delaunay), so small dots are easy to hit.
    const delaunay = d3.Delaunay.from(marks, d => x(d.income), d => y(d.rent));
    svg.on("pointermove", event => {
      const [px, py] = d3.pointer(event);
      const i = delaunay.find(px, py);
      const m = marks[i];
      if (Math.hypot(x(m.income) - px, y(m.rent) - py) < 24) show(m); else hide();
    }).on("pointerleave", hide);

    function show(m) {
      dots.classed("active", d => d === m);
      dots.filter(d => d === m).raise();
      tooltip.attr("hidden", null).html(tooltipHTML(m));
      // Position near the point, flipping/clamping so it stays inside the chart.
      const node = tooltip.node();
      const tw = node.offsetWidth, th = node.offsetHeight;
      let left = x(m.income) + 12;
      if (left + tw > width) left = x(m.income) - tw - 12;
      let top = y(m.rent) - th - 10;
      if (top < 0) top = y(m.rent) + 12;
      tooltip.style("left", `${Math.max(0, left)}px`).style("top", `${top}px`);
    }

    function hide() {
      dots.classed("active", false);
      tooltip.attr("hidden", true);
    }
  }

  function tooltipText(m) {
    const d = m.members[0]; // members of a shared mark have identical values
    const label = m.members.length > 1
      ? `${m.members.length} ZIP codes: ${m.members.map(r => r.zcta).join(", ")}`
      : `ZIP code ${d.zcta}`;
    return [
      label,
      `Median household income: ${formatEstimate(d.income, d.incomeTopcoded)}`,
      `Median gross rent: ${formatEstimate(d.rent, d.rentTopcoded)}`,
    ];
  }

  function tooltipHTML(m) {
    const [label, ...lines] = tooltipText(m);
    return `<strong>${label}</strong>${lines.join("<br>")}`;
  }

  // Redraw only when the width changes (redrawing changes the height itself).
  let lastWidth = 0;
  new ResizeObserver(() => {
    if (container.clientWidth !== lastWidth) {
      lastWidth = container.clientWidth;
      draw();
    }
  }).observe(container);
});
