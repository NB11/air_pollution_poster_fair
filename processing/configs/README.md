# PNG Converter Configuration

Simple configuration file for the PNG converter script.

## Configuration File: `png_converter_config.yml`

This YAML file has only one setting:

### `clip_to_boundary`
- **`true`**: Clip rasters to city/municipality boundaries from GeoJSON files
- **`false`**: Convert without clipping (full raster extent)

### Example

To enable clipping:
```yaml
clip_to_boundary: true
```

To disable clipping:
```yaml
clip_to_boundary: false
```

### Usage

1. Edit `png_converter_config.yml` to set `clip_to_boundary: true` or `false`
2. Run the converter:
   ```bash
   python processing/png_converter_for_webmap.py --city Frascati
   ```

The script will automatically read the config file and apply the clipping setting.
