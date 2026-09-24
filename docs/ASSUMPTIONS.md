# Agricultural & Analytical Assumptions Log (`docs/ASSUMPTIONS.md`)

All agricultural coefficients, efficiencies, thresholds, and analytical weights are transparently logged here. Any parameter marked `verified=false` is a provisional engineering baseline and must be reviewed by an agricultural scientist or CSP faculty before real-world farmer deployment.

---

## 1. Irrigation Method Efficiencies

| Method Code | Method Name | Typical Efficiency | Source | Verified | Notes |
|---|---|---|---|---|---|
| `drip` | Drip Irrigation | 0.90 (90%) | FAO Irrigation & Drainage Paper 24/56 | `true` | Well-maintained drip system |
| `sprinkler` | Sprinkler Irrigation | 0.75 (75%) | FAO Irrigation & Drainage Paper 56 | `true` | Standard overhead impact sprinkler |
| `furrow` | Furrow / Ridge & Furrow | 0.65 (65%) | ICAR Guidelines | `false` | Baseline estimate for alluvial/black soils |
| `flood` | Flood / Basin Irrigation | 0.50 (50%) | ICAR / AP Agricultural University | `false` | Traditional flooding with distribution losses |
| `rainfed` | Rainfed / Supplemental | 1.00 (100%) | Baseline Definition | `true` | No mechanical distribution losses |

---

## 2. Crop Stages & Crop Coefficients (Kc)

### Paddy / Rice (`water_model='paddy_ponding'`)
- **Duration:** 120 days (Kharif / Rabi standard variety)
- **Stages:**
  1. *Land Preparation & Nursery* (DAS 0–20): Kc = 1.10 (`verified=false`). Water includes puddling requirement (assumed 200 mm baseline).
  2. *Vegetative / Tillering* (DAS 21–55): Kc = 1.15 (`verified=false`). Standing water depth target 30–50 mm.
  3. *Reproductive / Panicle Initiation & Flowering* (DAS 56–85): Kc = 1.25 (`verified=false`). Critical water-sensitive period.
  4. *Ripening / Maturation* (DAS 86–120): Kc = 0.95 (`verified=false`). Drainage 10–15 days before harvest.
- **Paddy Model Parameters:**
  - `puddling_water_mm`: 200 mm (`verified=false`, ICAR baseline)
  - `percolation_rate_mm_day`: 4.0 mm/day (`verified=false`, typical sandy-clay loam in AP)
  - `target_ponding_depth_mm`: 40 mm (`verified=false`)

### Maize / Corn (`water_model='kc_standard'`)
- **Duration:** 105 days
- **Stages:**
  1. *Initial* (DAS 0–20): Kc = 0.40 (`verified=true`, FAO-56 Table 12)
  2. *Crop Development* (DAS 21–50): Kc = 0.80 (`verified=true`, FAO-56)
  3. *Mid-Season / Tasseling & Silking* (DAS 51–80): Kc = 1.15 (`verified=true`, FAO-56)
  4. *Late Season / Grain Fill & Maturity* (DAS 81–105): Kc = 0.60 (`verified=true`, FAO-56)

### Chilli (`water_model='kc_standard'`)
- **Duration:** 150 days (Guntur / Krishna AP variety)
- **Stages:**
  1. *Transplanting & Establishment* (DAS 0–25): Kc = 0.45 (`verified=false`, provisional)
  2. *Vegetative & Branching* (DAS 26–65): Kc = 0.75 (`verified=false`, provisional)
  3. *Flowering & Fruit Setting* (DAS 66–115): Kc = 1.05 (`verified=false`, provisional)
  4. *Fruit Ripening & Picking* (DAS 116–150): Kc = 0.80 (`verified=false`, provisional)

---

## 3. Effective Rainfall Method
- **Algorithm (Configurable in `app_settings`):**
  - Daily rainfall < 5.0 mm: Considered lost to interception and surface evaporation -> `effective_rain = 0 mm`.
  - Daily rainfall between 5.0 mm and 50.0 mm: `effective_rain = (daily_rain - 5.0) * 0.75`.
  - Daily rainfall > 50.0 mm: Capped at maximum soil moisture infiltration capacity of `35.0 mm/day` (`verified=false`).

---

## 4. Water Volume Proxy Conversion
- **Pump Running Hours:**
  - `Estimated Litres = pump_hours * discharge_rate_lph`
  - Measurement Type: Always labeled `estimated`, raw provenance `farmer_reported`.
  - Unit Area Depth: `1 mm depth over 1 acre = 4,046.86 Litres`.

---

## 5. Data Confidence Scoring Weights
- Response Coverage Weight: 40% (cycles answered / cycles due)
- Completeness of Key Fields: 30% (pump hours, condition, rainfall confirmation)
- Field Evidence Verification: 15% (staff visit or ground spot-check)
- Consistency (Lack of Anomaly Flags): 15%
- Bands: High (>= 80%), Medium (60–79%), Low (< 60%). Certificate eligibility requires >= 70% confidence.
