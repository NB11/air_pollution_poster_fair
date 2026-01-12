# Processing Scripts

This folder contains data processing scripts used to prepare data for the web map.

## Scripts

- **convert_stations_to_geojson.py** - Converts ground station parquet data to GeoJSON files, creating separate files for each pollutant-month combination
- **convert_geotiff_to_png.py** - Converts GeoTIFF files to PNG format with bounds JSON for web map display
- **fix_bounds_accurate.py** - Fixes bounds in GeoJSON files using accurate coordinate transformation
- **fix_bounds_manual.py** - Manually fixes bounds by converting UTM coordinates to WGS84
- **fix_composite_bounds.py** - Fixes bounds for composite image files
- **verify_and_fix_bounds.py** - Verifies and fixes bounds in GeoJSON files

## Usage

All scripts should be run from the project root directory. Paths in the scripts are relative to the project root.

Example:
```bash
# From project root
python processing/convert_stations_to_geojson.py
python processing/convert_geotiff_to_png.py map/s2/file.geotiff
```

