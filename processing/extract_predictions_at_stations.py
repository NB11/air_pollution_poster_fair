"""
Extract predicted values at ground station locations from TIF files.
Creates enhanced GeoJSON files with both ground truth and predicted values.
Only processes stations that are within the bounds of cities where we have prediction data.

Usage:
    python processing/extract_predictions_at_stations.py                    # Process all cities
    python processing/extract_predictions_at_stations.py --city Bologna     # Process specific city
    python processing/extract_predictions_at_stations.py --city Bologna --year 2024
"""

import os
import sys
import json
import argparse
import re
from pathlib import Path

# Add processing folder to path for imports
script_dir = Path(__file__).parent
project_root = script_dir.parent

# Set UTF-8 encoding for Windows console
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')


# City bounding boxes (lon_min, lat_min, lon_max, lat_max) in WGS84
CITY_BOUNDS = {
    'Frascati': (12.5, 41.7, 12.9, 41.95),
    'Bologna': (11.15, 44.35, 11.50, 44.60),
    'Milano': (9.00, 45.35, 9.35, 45.55)
}


def is_point_in_bounds(lon, lat, bounds):
    """Check if a point is within the given bounding box."""
    lon_min, lat_min, lon_max, lat_max = bounds
    return lon_min <= lon <= lon_max and lat_min <= lat <= lat_max


def parse_tif_filename(filename):
    """
    Parse TIF filename to extract year, month, pollutant.
    Pattern: YYYY_MM_POLLUTANT_interpolated.tif
    Example: 2024_01_NO2_interpolated.tif -> (2024, 01, NO2)
    """
    pattern = r'^(\d{4})_(\d{2})_([A-Za-z0-9_]+)_interpolated\.tif$'
    match = re.match(pattern, filename)
    if match:
        year = match.group(1)
        month = match.group(2)
        pollutant = match.group(3)
        return year, month, pollutant
    return None, None, None


def load_ground_stations(stations_file):
    """Load ground station GeoJSON file."""
    if not stations_file.exists():
        return None
    
    with open(stations_file, 'r', encoding='utf-8') as f:
        return json.load(f)


def wgs84_to_utm(lon, lat, zone, northern=True):
    """
    Convert WGS84 coordinates to UTM.
    Manual implementation to avoid PROJ database issues.
    """
    import math
    
    k0 = 0.9996  # UTM scale factor
    a = 6378137.0  # WGS84 semi-major axis
    e2 = 0.00669438  # WGS84 first eccentricity squared
    
    # Central meridian for the zone
    lon0 = math.radians((zone - 1) * 6 - 180 + 3)
    
    lat_rad = math.radians(lat)
    lon_rad = math.radians(lon)
    
    sin_lat = math.sin(lat_rad)
    cos_lat = math.cos(lat_rad)
    tan_lat = math.tan(lat_rad)
    
    N = a / math.sqrt(1 - e2 * sin_lat**2)
    T = tan_lat**2
    C = (e2 / (1 - e2)) * cos_lat**2
    A = (lon_rad - lon0) * cos_lat
    
    M = a * ((1 - e2/4 - 3*e2**2/64 - 5*e2**3/256) * lat_rad
            - (3*e2/8 + 3*e2**2/32 + 45*e2**3/1024) * math.sin(2*lat_rad)
            + (15*e2**2/256 + 45*e2**3/1024) * math.sin(4*lat_rad)
            - (35*e2**3/3072) * math.sin(6*lat_rad))
    
    easting = k0 * N * (A + (1 - T + C) * A**3/6 
                        + (5 - 18*T + T**2 + 72*C - 58*(e2/(1-e2))) * A**5/120) + 500000.0
    
    northing = k0 * (M + N * tan_lat * (A**2/2 
                     + (5 - T + 9*C + 4*C**2) * A**4/24
                     + (61 - 58*T + T**2 + 600*C - 330*(e2/(1-e2))) * A**6/720))
    
    if not northern:
        northing += 10000000.0
    
    return easting, northing


def extract_utm_zone(crs_str):
    """Extract UTM zone number from CRS string."""
    import re
    match = re.search(r'UTM zone (\d+)([NS])', str(crs_str), re.IGNORECASE)
    if match:
        zone = int(match.group(1))
        northern = match.group(2).upper() == 'N'
        return zone, northern
    return None, None


def extract_prediction_at_point(tif_path, lon, lat):
    """
    Extract predicted value from TIF at given lon/lat coordinates.
    Returns the predicted value or None if outside bounds or invalid.
    Uses manual UTM transformation to avoid PROJ database issues.
    """
    try:
        import rasterio
        from rasterio.transform import rowcol
        import numpy as np
        
        with rasterio.open(tif_path) as src:
            # Convert lon/lat to raster coordinates
            # First check if we need to transform
            if src.crs and src.crs.to_string() != 'EPSG:4326':
                # Extract UTM zone from CRS
                zone, northern = extract_utm_zone(str(src.crs))
                
                if zone:
                    # Manual UTM transformation
                    x, y = wgs84_to_utm(lon, lat, zone, northern)
                else:
                    # Try fallback - assume already in correct CRS
                    x, y = lon, lat
            else:
                x, y = lon, lat
            
            # Get row/col in raster
            row, col = rowcol(src.transform, x, y)
            
            # Check bounds
            if row < 0 or row >= src.height or col < 0 or col >= src.width:
                return None
            
            # Read value
            data = src.read(1)
            value = data[row, col]
            
            # Check for nodata/invalid values
            if np.isnan(value) or value < -1e10 or value > 1e10:
                return None
            
            return float(value)
            
    except Exception as e:
        # print(f"  Warning: Could not extract value from {tif_path.name}: {e}")
        return None


def utm_to_wgs84(easting, northing, zone, northern=True):
    """
    Convert UTM coordinates to WGS84 (latitude/longitude).
    Manual implementation to avoid PROJ database issues.
    """
    import math
    
    k0 = 0.9996  # UTM scale factor
    a = 6378137.0  # WGS84 semi-major axis
    e2 = 0.00669438  # WGS84 first eccentricity squared
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    
    # Central meridian for the zone (in radians)
    lon0_deg = (zone - 1) * 6 - 180 + 3  # Center of UTM zone in degrees
    lon0 = math.radians(lon0_deg)
    
    # Remove false easting and northing
    x = easting - 500000.0
    y = northing if northern else northing - 10000000.0
    
    # Footprint latitude
    M = y / k0
    mu = M / (a * (1 - e2/4 - 3*e2**2/64 - 5*e2**3/256))
    
    e1_2 = e1**2
    e1_3 = e1**3
    e1_4 = e1**4
    
    phi1 = mu + (3*e1/2 - 27*e1_3/32) * math.sin(2*mu) \
         + (21*e1_2/16 - 55*e1_4/32) * math.sin(4*mu) \
         + (151*e1_3/96) * math.sin(6*mu) \
         + (1097*e1_4/512) * math.sin(8*mu)
    
    sin_phi1 = math.sin(phi1)
    cos_phi1 = math.cos(phi1)
    tan_phi1 = math.tan(phi1)
    
    N1 = a / math.sqrt(1 - e2 * sin_phi1**2)
    T1 = tan_phi1**2
    C1 = (e2/(1-e2)) * cos_phi1**2
    R1 = a * (1 - e2) / ((1 - e2 * sin_phi1**2)**1.5)
    D = x / (N1 * k0)
    
    lat = phi1 - (N1 * tan_phi1 / R1) * (D**2/2 - (5 + 3*T1 + 10*C1 - 4*C1**2 - 9*(e2/(1-e2))) * D**4/24 \
        + (61 + 90*T1 + 298*C1 + 45*T1**2 - 252*(e2/(1-e2)) - 3*C1**2) * D**6/720)
    
    lon = lon0 + (D - (1 + 2*T1 + C1) * D**3/6 \
        + (5 - 2*C1 + 28*T1 - 3*C1**2 + 8*(e2/(1-e2)) + 24*T1**2) * D**5/120) / cos_phi1
    
    return math.degrees(lon), math.degrees(lat)


def get_tif_bounds_wgs84(tif_path):
    """Get the WGS84 bounding box of a TIF file using manual transformation."""
    try:
        import rasterio
        
        with rasterio.open(tif_path) as src:
            bounds = src.bounds
            
            # Transform to WGS84 if needed
            if src.crs and src.crs.to_string() != 'EPSG:4326':
                # Extract UTM zone
                zone, northern = extract_utm_zone(str(src.crs))
                
                if zone:
                    # Manual transformation of corners
                    min_lon, min_lat = utm_to_wgs84(bounds.left, bounds.bottom, zone, northern)
                    max_lon, max_lat = utm_to_wgs84(bounds.right, bounds.top, zone, northern)
                    return (min_lon, min_lat, max_lon, max_lat)
            
            return bounds  # (west, south, east, north)
    except Exception as e:
        print(f"  Warning: Could not get bounds from {tif_path.name}: {e}")
        return None


def filter_stations_by_bounds(stations_data, bounds, buffer=0.01):
    """
    Filter stations to only include those within the given bounds.
    buffer: extra margin in degrees to include nearby stations
    """
    if not bounds:
        return stations_data
    
    west, south, east, north = bounds
    # Add buffer
    west -= buffer
    south -= buffer
    east += buffer
    north += buffer
    
    filtered_features = []
    
    for feature in stations_data.get('features', []):
        coords = feature['geometry']['coordinates']
        lon, lat = coords[0], coords[1]
        
        if west <= lon <= east and south <= lat <= north:
            filtered_features.append(feature)
    
    return {
        'type': 'FeatureCollection',
        'features': filtered_features
    }


def process_city_year_month(city_name, year, month, raw_maps_dir, stations_dir, output_dir):
    """
    Process one city/year/month combination.
    Extract predictions at station locations ONLY within the city bounds.
    """
    # Pollutants to process
    pollutants = ['NO2', 'O3', 'PM10', 'PM2_5']
    
    # Get city bounds for filtering
    city_bounds = CITY_BOUNDS.get(city_name)
    if not city_bounds:
        print(f"  Warning: No bounds defined for {city_name}, skipping spatial filtering")
    
    results = {}
    
    for pollutant in pollutants:
        # Path to TIF file
        tif_filename = f"{year}_{month}_{pollutant}_interpolated.tif"
        tif_path = raw_maps_dir / city_name / year / 'predictions' / year / f'month_{month}' / tif_filename
        
        if not tif_path.exists():
            continue
        
        # Path to ground stations file (global)
        stations_filename = f"stations_{pollutant}_{year}_{month}.geojson"
        stations_path = stations_dir / stations_filename
        
        if not stations_path.exists():
            continue
        
        # Load ALL ground stations first
        all_stations_data = load_ground_stations(stations_path)
        if not all_stations_data:
            continue
        
        total_global_stations = len(all_stations_data.get('features', []))
        
        # Filter to only stations within city bounds
        if city_bounds:
            stations_data = filter_stations_by_bounds(all_stations_data, city_bounds)
        else:
            # Fallback: use TIF bounds
            tif_bounds = get_tif_bounds_wgs84(tif_path)
            stations_data = filter_stations_by_bounds(all_stations_data, tif_bounds)
        
        filtered_count = len(stations_data.get('features', []))
        
        if filtered_count == 0:
            print(f"  {pollutant}: No stations found within {city_name} bounds (0/{total_global_stations})")
            continue
        
        print(f"  {pollutant}: Processing {filtered_count}/{total_global_stations} stations within {city_name} bounds")
        
        # Create enhanced features with predicted values
        enhanced_features = []
        stations_with_predictions = 0
        
        for feature in stations_data.get('features', []):
            coords = feature['geometry']['coordinates']
            lon, lat = coords[0], coords[1]
            
            # Extract predicted value at this location
            predicted_value = extract_prediction_at_point(tif_path, lon, lat)
            
            # Create enhanced feature
            enhanced_feature = {
                'type': 'Feature',
                'geometry': feature['geometry'],
                'properties': {
                    **feature['properties'],
                    'predicted_value': predicted_value
                }
            }
            
            enhanced_features.append(enhanced_feature)
            
            if predicted_value is not None:
                stations_with_predictions += 1
        
        # Only save if we have stations with predictions
        if enhanced_features:
            # Create enhanced GeoJSON
            enhanced_geojson = {
                'type': 'FeatureCollection',
                'features': enhanced_features
            }
            
            # Save to output directory
            output_city_dir = output_dir / city_name / year
            output_city_dir.mkdir(parents=True, exist_ok=True)
            
            output_path = output_city_dir / stations_filename
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(enhanced_geojson, f, indent=2)
            
            results[pollutant] = {
                'filtered_stations': filtered_count,
                'with_predictions': stations_with_predictions,
                'output_file': output_path
            }
        else:
            print(f"  {pollutant}: No stations with valid predictions")
    
    return results


def find_available_data(raw_maps_dir, city=None, year=None):
    """
    Find all available city/year/month combinations.
    Returns list of (city, year, month) tuples.
    """
    data = []
    
    for city_dir in raw_maps_dir.iterdir():
        if not city_dir.is_dir():
            continue
        
        city_name = city_dir.name
        
        # Skip non-city directories
        if city_name in ['bounds', '.git', '__pycache__']:
            continue
        
        # Filter by city if specified
        if city and city_name.lower() != city.lower():
            continue
        
        for year_dir in city_dir.iterdir():
            if not year_dir.is_dir():
                continue
            
            year_name = year_dir.name
            
            # Skip non-year directories
            if not year_name.isdigit():
                continue
            
            # Filter by year if specified
            if year and year_name != str(year):
                continue
            
            # Look for predictions folder
            predictions_dir = year_dir / 'predictions' / year_name
            if not predictions_dir.exists():
                continue
            
            # Find all month folders
            for month_dir in predictions_dir.iterdir():
                if not month_dir.is_dir() or not month_dir.name.startswith('month_'):
                    continue
                
                month = month_dir.name.replace('month_', '')
                data.append((city_name, year_name, month))
    
    return data


def main():
    parser = argparse.ArgumentParser(
        description='Extract predicted values at ground station locations'
    )
    parser.add_argument('--city', type=str, help='Process specific city only')
    parser.add_argument('--year', type=str, help='Process specific year only')
    args = parser.parse_args()
    
    # Paths
    raw_maps_dir = project_root / 'raw_maps'
    stations_dir = project_root / 'map' / 'ground_truth_stations' / 'geojson'
    output_dir = project_root / 'map' / 'station_predictions'
    
    print(f"Raw maps directory: {raw_maps_dir}")
    print(f"Stations directory: {stations_dir}")
    print(f"Output directory: {output_dir}")
    
    if not raw_maps_dir.exists():
        print(f"Error: raw_maps directory not found: {raw_maps_dir}")
        sys.exit(1)
    
    if not stations_dir.exists():
        print(f"Error: stations directory not found: {stations_dir}")
        sys.exit(1)
    
    # Find available data
    print("\nScanning for available data...")
    available_data = find_available_data(raw_maps_dir, city=args.city, year=args.year)
    
    if not available_data:
        print("No data found to process.")
        sys.exit(0)
    
    print(f"Found {len(available_data)} city/year/month combinations to process")
    
    # Group by city/year for reporting
    cities_years = set((city, year) for city, year, month in available_data)
    print(f"Cities/years: {sorted(cities_years)}")
    
    # Process data
    print("\nProcessing stations...")
    
    total_processed = 0
    total_with_predictions = 0
    
    for city_name, year_name, month in available_data:
        print(f"\nProcessing {city_name} {year_name}-{month}...")
        
        results = process_city_year_month(
            city_name, year_name, month,
            raw_maps_dir, stations_dir, output_dir
        )
        
        for pollutant, info in results.items():
            print(f"    → {info['with_predictions']}/{info['filtered_stations']} stations with predictions saved")
            total_processed += info['filtered_stations']
            total_with_predictions += info['with_predictions']
    
    print(f"\nProcessing complete!")
    print(f"Total stations processed: {total_processed}")
    print(f"Total stations with predictions: {total_with_predictions}")
    print(f"Output directory: {output_dir}")


if __name__ == '__main__':
    main()

