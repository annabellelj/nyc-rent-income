"""
Clean and join ACS 2024 5-year income (B19013) and rent (B25064) estimates
with NYC Open Data ZIP Code Tabulation Area boundaries.

Reads only from data/raw/ (never modified) and writes:
  data/processed/nyc_rent_income.csv
  data/processed/nyc_rent_income.geojson

Run from the project root:  python3 scripts/clean_data.py
"""

import glob
import json
import math
import re
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "processed"


def find_one(pattern):
    """Locate exactly one raw file (Census download folders are timestamped)."""
    matches = glob.glob(str(RAW / pattern))
    if len(matches) != 1:
        raise FileNotFoundError(f"Expected one file for {pattern}, found {matches}")
    return matches[0]


# ---------------------------------------------------------------------------
# Census value parsing
#
# Census writes annotation symbols directly into the estimate/MOE columns.
# Definitions come from the "Explanation of Symbols" in the Table-Notes files:
#   "-"        estimate could not be computed (insufficient sample)
#   "N"        not displayed (insufficient sample)
#   "(X)"      not applicable / not available
#   "250,000+" median is in the open-ended top interval  -> top-coded
#   "2,500-"   median is in the open-ended bottom interval -> bottom-coded
#   "**", "***", "*****" (MOE only) margin of error not computable / not appropriate
#
# Nothing is ever converted to zero. Any token not listed here stops the script.
# ---------------------------------------------------------------------------
MISSING_TOKENS = {"-", "N", "(X)", ""}
MOE_MISSING_TOKENS = MISSING_TOKENS | {"**", "***", "*****"}
OPEN_ENDED = re.compile(r"^([\d,]+)([+-])$")


def parse_estimate(raw):
    """Return (value, status). status is exact | topcoded | bottomcoded | missing.

    For top/bottom-coded values, value is the published bound (e.g. 250000 for
    "250,000+"), NOT a known exact value.
    """
    s = str(raw).strip()
    if s in MISSING_TOKENS:
        return None, "missing"
    if re.fullmatch(r"\d+", s):
        return int(s), "exact"
    m = OPEN_ENDED.match(s)
    if m:
        bound = int(m.group(1).replace(",", ""))
        return bound, "topcoded" if m.group(2) == "+" else "bottomcoded"
    raise ValueError(f"Unrecognized Census estimate value: {raw!r}")


def parse_moe(raw):
    s = str(raw).strip()
    if s in MOE_MISSING_TOKENS:
        return None
    if re.fullmatch(r"\d+", s):
        return int(s)
    raise ValueError(f"Unrecognized Census MOE value: {raw!r}")


def read_census(path, estimate_col, name):
    """Read one ACS table export and return zcta, <name>, <name>_status, <name>_moe."""
    # utf-8-sig strips the BOM; skiprows=[1] drops the second header row of long
    # labels; dtype=str keeps ZCTAs like "06390" from losing their leading zero.
    df = pd.read_csv(path, dtype=str, skiprows=[1], encoding="utf-8-sig", keep_default_na=False)
    df = df.loc[:, ~df.columns.str.startswith("Unnamed")]  # trailing comma column

    # GEO_ID looks like "860Z200US10001": summary level 860 (ZCTA) + 5-char code.
    assert df["GEO_ID"].str.startswith("860Z200US").all(), "Non-ZCTA rows found"
    df["zcta"] = df["GEO_ID"].str[-5:]
    assert df["zcta"].str.fullmatch(r"\d{5}").all()
    assert (df["NAME"] == "ZCTA5 " + df["zcta"]).all(), "GEO_ID and NAME disagree"

    parsed = df[estimate_col].map(parse_estimate)
    out = pd.DataFrame({
        "zcta": df["zcta"],
        name: [v for v, _ in parsed],
        f"{name}_status": [s for _, s in parsed],
        f"{name}_moe": df[estimate_col[:-1] + "M"].map(parse_moe),
    })
    out[name] = out[name].astype("Int64")
    out[f"{name}_moe"] = out[f"{name}_moe"].astype("Int64")
    return out


# ---------------------------------------------------------------------------
# NYC geography
# ---------------------------------------------------------------------------
def round_coords(coords, ndigits=6):
    """Round nested GeoJSON coordinates (6 decimals is roughly 0.1 m)."""
    if isinstance(coords[0], (int, float)):
        return [round(c, ndigits) for c in coords]
    return [round_coords(c, ndigits) for c in coords]


def check_geometry(geom):
    """Basic structural validation; returns a problem description or None."""
    if not geom or geom.get("type") not in ("Polygon", "MultiPolygon"):
        return f"unexpected geometry type {geom and geom.get('type')}"
    polygons = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    for poly in polygons:
        for ring in poly:
            if len(ring) < 4 or ring[0] != ring[-1]:
                return "ring is unclosed or has fewer than 4 points"
            for lon, lat in ring:
                if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                    return "coordinate outside lon/lat range"
    return None


EARTH_RADIUS_M = 6371008.8


def ring_area_m2(ring):
    """Approximate area of a lon/lat ring on a sphere, in square meters."""
    total = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        total += math.radians(x2 - x1) * (2 + math.sin(math.radians(y1)) + math.sin(math.radians(y2)))
    return abs(total * EARTH_RADIUS_M ** 2 / 2)


def geometry_area_m2(geom):
    polygons = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    # outer ring minus holes
    return sum(ring_area_m2(p[0]) - sum(ring_area_m2(h) for h in p[1:]) for p in polygons)


def read_nyc_geography(path):
    with open(path) as f:
        fc = json.load(f)
    rows, geoms = [], {}
    for feat in fc["features"]:
        p = feat["properties"]
        problem = check_geometry(feat["geometry"])
        # Coverage = area of the NYC polygon / full Census ZCTA area. The NYC
        # Open Data polygons are clipped to the city boundary, while arealand +
        # areawater (and the ACS estimates) describe the full Census ZCTA.
        full_area = int(p["arealand"]) + int(p["areawater"])
        coverage = None if problem else geometry_area_m2(feat["geometry"]) / full_area
        rows.append({"zcta": p["zcta5"], "geometry_problem": problem, "nyc_coverage": coverage})
        geoms[p["zcta5"]] = feat["geometry"]
    return pd.DataFrame(rows), geoms


# ---------------------------------------------------------------------------
def main():
    income = read_census(find_one("income/*/*B19013-Data.csv"), "B19013_001E", "income")
    rent = read_census(find_one("rent/*/*B25064-Data.csv"), "B25064_001E", "rent")
    nyc, geoms = read_nyc_geography(find_one("nyc-zcta/*.geojson"))

    print("SOURCE ROWS")
    print(f"  income (B19013, NY State ZCTAs): {len(income)}")
    print(f"  rent   (B25064, NY State ZCTAs): {len(rent)}")
    print(f"  NYC ZCTA geography features:     {len(nyc)}")

    print("\nDUPLICATE ZCTAs")
    for label, df in [("income", income), ("rent", rent), ("NYC geography", nyc)]:
        dups = df.loc[df["zcta"].duplicated(keep=False), "zcta"].unique().tolist()
        print(f"  {label}: {len(dups)} {dups if dups else ''}")
        assert not dups, f"Duplicate ZCTAs in {label}"

    bad_geom = nyc[nyc["geometry_problem"].notna()]
    print(f"\nGEOMETRY PROBLEMS: {len(bad_geom)}")
    for _, r in bad_geom.iterrows():
        print(f"  {r.zcta}: {r.geometry_problem}")
    nyc = nyc[nyc["geometry_problem"].isna()].drop(columns="geometry_problem")

    # --- Merge 1: income + rent (both are full NY State ZCTA lists) ---------
    # indicator=True lets us report rows present in only one table.
    acs = income.merge(rent, on="zcta", how="outer", indicator=True)
    print("\nINCOME + RENT MERGE (NY State)")
    print(f"  matched:           {(acs._merge == 'both').sum()}")
    print(f"  income only:       {acs.loc[acs._merge == 'left_only', 'zcta'].tolist()}")
    print(f"  rent only:         {acs.loc[acs._merge == 'right_only', 'zcta'].tolist()}")
    acs = acs[acs._merge == "both"].drop(columns="_merge")

    # --- Merge 2: filter to NYC using the official NYC ZCTA list ------------
    # NYC membership comes only from the NYC Open Data file, never from ZIP prefixes.
    joined = nyc.merge(acs, on="zcta", how="outer", indicator=True)
    geo_only = joined.loc[joined._merge == "left_only", "zcta"].tolist()
    print("\nNYC GEOGRAPHY + ACS JOIN")
    print(f"  NYC ZCTAs matched to ACS:              {(joined._merge == 'both').sum()}")
    print(f"  NYC geography with no ACS row (dropped): {geo_only}")
    print(f"  NY State ACS ZCTAs outside NYC file:   {(joined._merge == 'right_only').sum()} (excluded, not NYC)")
    df = joined[joined._merge == "both"].drop(columns="_merge")

    # --- Border / sliver ZCTAs ----------------------------------------------
    # The NYC Open Data polygons are clipped to the city boundary, while ACS
    # estimates describe the full Census ZCTA. ZCTAs represented only by small
    # slivers inside NYC are excluded to avoid mapping mostly non-NYC ACS
    # estimates onto small NYC fragments. This uses geography only and runs
    # before any income/rent analysis.
    #
    # Observed coverage is strongly bimodal (slivers <= ~12%, all others >= ~98%).
    # The threshold sits inside that gap, so its exact value does not affect
    # which ZCTAs are classified; the assertion below fails if a future data
    # release puts any ZCTA inside the gap.
    SLIVER_THRESHOLD = 0.5
    assert not df["nyc_coverage"].between(0.2, 0.9).any(), "ZCTA coverage falls inside the expected gap"
    is_sliver = df["nyc_coverage"] < SLIVER_THRESHOLD
    slivers, df = df[is_sliver], df[~is_sliver]
    print("\nBORDER / SLIVER ZCTAs (share of full Census ZCTA area inside NYC geometry)")
    print(f"  excluded matched slivers: {len(slivers)}")
    for _, r in slivers.sort_values("nyc_coverage").iterrows():
        print(f"    {r.zcta}  {r.nyc_coverage:6.1%}")
    print(f"  unmatched geography:      {geo_only}")
    print(f"  maximum coverage among excluded matched slivers: {slivers.nyc_coverage.max():.1%}")
    print(f"  minimum coverage among retained ZCTAs:           {df.nyc_coverage.min():.1%}")
    print(f"  retained ZCTAs (substantially represented within the NYC geography): {len(df)}")
    df = df.sort_values("zcta").reset_index(drop=True)

    # Bottom-coded values have no output flag; none are expected in NYC.
    for col in ("income", "rent"):
        n = (df[f"{col}_status"] == "bottomcoded").sum()
        assert n == 0, f"{n} bottom-coded {col} values in NYC need explicit handling"

    print("\nESTIMATE STATUS (NYC ZCTAs with ACS rows)")
    status = pd.DataFrame({c: df[f"{c}_status"].value_counts() for c in ("income", "rent")}).fillna(0).astype(int)
    print("  " + status.to_string().replace("\n", "\n  "))

    df["income_topcoded"] = df["income_status"] == "topcoded"
    df["rent_topcoded"] = df["rent_status"] == "topcoded"

    both_exact = (df.income_status == "exact") & (df.rent_status == "exact")
    both_present = df.income.notna() & df.rent.notna()
    either_missing = ~both_present
    print("\nANALYSIS GROUPS")
    print(f"  both estimates exact:                     {both_exact.sum()}")
    print(f"  both present, at least one top-coded:     {(both_present & ~both_exact).sum()}")
    print(f"  at least one estimate missing:            {either_missing.sum()}")
    print(f"    income missing: {df.income.isna().sum()}   rent missing: {df.rent.isna().sum()}")
    print(f"  top-coded ZCTAs: {df.loc[~both_exact & both_present, 'zcta'].tolist()}")
    print(f"  missing ZCTAs:   {df.loc[either_missing, 'zcta'].tolist()}")

    # --- Outputs -------------------------------------------------------------
    cols = ["zcta", "income", "income_topcoded", "income_moe",
            "rent", "rent_topcoded", "rent_moe"]
    out = df[cols]
    OUT.mkdir(parents=True, exist_ok=True)
    csv_path = OUT / "nyc_rent_income.csv"
    out.to_csv(csv_path, index=False)  # missing values are written as empty cells

    def clean(v):
        return None if pd.isna(v) else (bool(v) if isinstance(v, bool) else int(v))

    features = []
    for rec in out.to_dict("records"):
        props = {"zcta": rec["zcta"], **{k: clean(rec[k]) for k in cols[1:]}}
        geom = geoms[rec["zcta"]]
        features.append({
            "type": "Feature",
            "properties": props,
            "geometry": {"type": geom["type"], "coordinates": round_coords(geom["coordinates"])},
        })
    geo_path = OUT / "nyc_rent_income.geojson"
    with open(geo_path, "w") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f, separators=(",", ":"))

    print("\nOUTPUT")
    print(f"  {csv_path.relative_to(ROOT)}: {len(out)} rows")
    print(f"  {geo_path.relative_to(ROOT)}: {len(features)} features, {geo_path.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
