# NYC Rent & Income

A small data visualization project comparing median household income and median gross rent across New York City's ZIP Code Tabulation Areas (ZCTAs), using the Census Bureau's 2024 American Community Survey 5-Year estimates.

## Question

How does median household income relate to median gross rent across NYC ZCTAs?

## Data

| Source | Used for |
|---|---|
| U.S. Census Bureau, 2024 ACS 5-Year, [B19013: Median Household Income](https://data.census.gov/table/ACSDT5Y2024.B19013) | income estimates (New York State ZCTAs) |
| U.S. Census Bureau, 2024 ACS 5-Year, [B25064: Median Gross Rent](https://data.census.gov/table/ACSDT5Y2024.B25064) | rent estimates (New York State ZCTAs) |
| NYC Open Data, [ZIP Code Tabulation Areas](https://data.cityofnewyork.us/City-Government/ZIP-Code-Tabulation-Areas/35j5-n34v) | which ZCTAs are in NYC, and their boundaries |

Raw downloads live untouched in `data/raw/`. Basemap tiles are © OpenStreetMap contributors.

## Methodology

```
data/raw/  ──►  scripts/clean_data.py  ──►  data/processed/  ──►  index.html
 (Census CSVs,      (pandas: parse,          nyc_rent_income.csv     D3 scatterplot
  NYC GeoJSON)       join, validate)         nyc_rent_income.geojson Leaflet choropleth
```

`clean_data.py`:

1. **Reads the Census exports** (skipping the second header row and the trailing empty column) and takes the ZCTA code from the last five characters of `GEO_ID`, kept as a string.
2. **Parses Census annotations explicitly.** `-` means no estimate was published and becomes null, never zero. `250,000+` and `3,500+` are top-coded medians: the script stores the lower bound with an `income_topcoded` / `rent_topcoded` flag. Any token it doesn't recognize stops the script.
3. **Joins income and rent on ZCTA**, then keeps only ZCTAs present in the NYC Open Data file. It never filters by ZIP prefix. Unmatched rows are printed, not dropped silently; `07305` is in the NYC file but has no New York State Census record.
4. **Excludes border slivers** (see below).
5. **Writes** a CSV and a GeoJSON with 211 ZCTAs, including margins of error. ZCTAs without an estimate stay in both files with empty/null values.

### The geography issue

During validation, a few border ZCTAs looked suspicious. The NYC polygons are clipped to the city line, but the Census figures describe each *full* ZCTA. Comparing each polygon's area to the full Census area (`arealand + areawater`) showed a clean split: nine ZCTAs had at most 11.8% of their area in the NYC file, and every other ZCTA had at least 98.3%. Those nine would have put mostly non-NYC estimates onto small slivers of the map, so the script excludes them. It checks geography only, before looking at any income or rent values. The 50% threshold sits inside that gap, and an assertion fails if a future data release puts a ZCTA inside it.

### Analysis notes

- 169 ZCTAs have exact estimates for both measures. 11 more have at least one top-coded value. 30 ZCTAs lack an income estimate and 31 lack a rent estimate.
- The Pearson correlation on the 169 exact pairs is 0.86 (Spearman 0.86). This shows association across areas, not causation.
- The scatterplot's trend line is an ordinary least-squares fit to those 169 exact pairs only.
- Map classes are quintiles of exact estimates, rounded and calculated separately for income and rent.

## Visualizations

- **Scatterplot (D3 + SVG):** one point per ZCTA. Top-coded values are drawn as hollow circles and labeled with "+". Four ZCTAs that share the same top-coded point are drawn as one marker labeled "4 ZCTAs" rather than jittered. Points are keyboard-focusable.
- **Choropleth (Leaflet + GeoJSON):** an Income | Rent toggle with five classes plus a hatched "No estimate" class. One-finger dragging is off on touch screens so the map doesn't trap page scrolling.

## Run locally

```bash
python3 scripts/clean_data.py
```

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. The cleaning step needs Python 3 and pandas. The page is static and loads D3 7.9.0 and Leaflet 1.9.4 from cdnjs.

## Tech

Python · pandas · JavaScript · D3.js · Leaflet · SVG · GeoJSON · HTML/CSS

## Limitations

- **ZCTAs are not ZIP Codes.** They are Census areas built to approximate USPS ZIP Code delivery areas. They also vary widely in population, so each point or polygon counts equally regardless of how many people live there.
- **Margins of error.** ACS values are survey estimates, and some ZCTAs have wide margins.
- **Different populations.** Income covers all households, while gross rent covers only renter households paying cash rent.
- **Top-coding.** It hides the true values above $250,000 (income) and $3,500 (rent).
- **Association, not causation.** The charts show how two area-level medians vary together. They don't explain why, and they don't describe individual households.
- **Map keyboard access.** Map polygons are not keyboard-focusable; every ZCTA with both estimates can be reached through the scatterplot.
