"""
Convert ground station parquet data to GeoJSON files.
Creates separate GeoJSON files for each pollutant-month combination.
"""
import pandas as pd
import json
import os
from pathlib import Path

def create_geojson_from_df(df_subset):
    """Convert a DataFrame subset to GeoJSON format."""
    features = []
    
    for _, row in df_subset.iterrows():
        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [float(row['longitude']), float(row['latitude'])]
            },
            "properties": {
                "station_id": str(row['station_id']),
                "ground_truth_value": float(row['ground_truth_value']),
                "pollutant": str(row['pollutant']),
                "period_key": str(row['period_key'])
            }
        }
        features.append(feature)
    
    geojson = {
        "type": "FeatureCollection",
        "features": features
    }
    
    return geojson

def pollutant_to_filename(pollutant):
    """Convert pollutant name to filename format (PM2_5 -> PM2.5)."""
    return pollutant.replace('_', '.')

def main():
    # Paths (relative to project root, script is in processing/ folder)
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    parquet_path = project_root / 'map/ground_truth_stations/GLOBAL_master_catalog.parquet'
    output_dir = project_root / 'map/ground_truth_stations/geojson'
    
    # Create output directory
    output_dir.mkdir(parents=True, exist_ok=True)
    
    print(f"Reading parquet file: {parquet_path}")
    df = pd.read_parquet(parquet_path)
    
    print(f"Total records: {len(df)}")
    print(f"Unique pollutants: {df['pollutant'].unique()}")
    
    # Group by pollutant and period_key
    grouped = df.groupby(['pollutant', 'period_key'])
    
    file_count = 0
    total_stations = 0
    
    for (pollutant, period_key), group_df in grouped:
        # Extract year and month from period_key (format: YYYY-MM)
        year = period_key[:4]
        month = period_key[5:7]
        
        # Convert pollutant name for filename (PM2_5 -> PM2.5)
        pollutant_filename = pollutant_to_filename(pollutant)
        
        # Create filename: stations_NO2_2023_01.geojson
        filename = f"stations_{pollutant_filename}_{year}_{month}.geojson"
        filepath = output_dir / filename
        
        # Convert to GeoJSON
        geojson_data = create_geojson_from_df(group_df)
        
        # Save to file
        with open(filepath, 'w') as f:
            json.dump(geojson_data, f, indent=2)
        
        file_count += 1
        total_stations += len(group_df)
        
        if file_count % 50 == 0:
            print(f"Processed {file_count} files...")
    
    print(f"\nConversion complete!")
    print(f"   Created {file_count} GeoJSON files")
    print(f"   Total stations: {total_stations}")
    print(f"   Output directory: {output_dir}")

if __name__ == '__main__':
    main()

