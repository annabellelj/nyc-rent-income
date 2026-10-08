# NYC Income vs. Rent

An interactive data visualization exploring the relationship between median household income and median gross rent across New York City ZIP code areas using 2024 ACS 5-Year Estimates.

The project combines a D3 scatterplot with an interactive Leaflet map to show both the overall relationship between income and rent and how those patterns vary geographically across the city.

## Data

- U.S. Census Bureau, 2024 ACS 5-Year Estimates
  - [B19013: Median Household Income](https://data.census.gov/table/ACSDT5Y2024.B19013)
  - [B25064: Median Gross Rent](https://data.census.gov/table/ACSDT5Y2024.B25064)
- NYC Open Data: [ZIP Code Tabulation Areas](https://data.cityofnewyork.us/City-Government/ZIP-Code-Tabulation-Areas/35j5-n34v)

Census ZIP Code Tabulation Areas (ZCTAs) approximate ZIP code areas. A small number of border areas were excluded because only a small fraction of their geography falls within New York City.

## Built with

- D3.js
- Leaflet
- JavaScript
- Python
- pandas
- HTML/CSS

## Data processing

The Python pipeline cleans and joins the ACS income and rent tables, matches them to NYC ZCTA geography, and preserves missing values and Census top-coded estimates. It outputs the processed CSV and GeoJSON used by the visualization.
