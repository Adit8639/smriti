# Map outlines

`india.json` and `world.json` are simplified, pre-projected outlines built from
[Natural Earth](https://www.naturalearthdata.com/) data, which is in the public domain:

- admin-0 countries, **India point of view** (`ne_10m_admin_0_countries_ind`), so India's
  boundary follows the official Indian depiction;
- admin-1 states and provinces (only boundaries shared by two Indian states are drawn);
- 1:50m rivers and lake centre-lines.

Projection: equirectangular. India: x = (lon − 66) × cos 22° × 20, y = (38.5 − lat) × 20.
World: x = (lon + 180) × 2, y = (84 − lat) × 2. Pins from atoms' `geo {lat, lon}` use the
same formulas (`js/maps.js`). These outlines are for recall drills, not survey-grade maps.
