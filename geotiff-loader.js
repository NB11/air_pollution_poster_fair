// GeoTIFF Loader Module
// Handles loading and displaying GeoTIFF files on the map

/**
 * Load and display a GeoTIFF file on the map
 * @param {maplibregl.Map} mapInstance - The MapLibre map instance
 * @param {string} geotiffPath - Path to the GeoTIFF file
 * @param {Object} options - Configuration options
 */
async function loadGeoTIFFLayer(mapInstance, geotiffPath, options = {}) {
    const {
        layerId = 'geotiff-layer',
        sourceId = 'geotiff-source',
        opacity = 0.7,
        bandIndices = null, // [r, g, b] indices, null = auto-detect
        minMaxValues = null, // Custom min/max for normalization, null = auto-calculate
        insertBeforeLayer = 'satellite-layer'
    } = options;

    try {
        console.log('🌍 Loading GeoTIFF:', geotiffPath);
        
        // Check if GeoTIFF library is available
        if (typeof GeoTIFF === 'undefined') {
            console.error('❌ GeoTIFF library not loaded. Make sure geotiff.js is included in your HTML.');
            return;
        }

        // Fetch the GeoTIFF file
        const response = await fetch(geotiffPath);
        if (!response.ok) {
            console.warn(`⚠️ GeoTIFF file not found at ${geotiffPath}, skipping...`);
            return;
        }

        console.log('📦 Fetching GeoTIFF file...');
        const arrayBuffer = await response.arrayBuffer();
        console.log('✅ File fetched, size:', (arrayBuffer.byteLength / 1024 / 1024).toFixed(2), 'MB');

        // Parse the GeoTIFF
        console.log('🔍 Parsing GeoTIFF...');
        const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
        const image = await tiff.getImage();
        
        // Get the bounding box (bounds) from the GeoTIFF
        const bbox = image.getBoundingBox();
        const [minX, minY, maxX, maxY] = bbox;
        
        console.log('📍 GeoTIFF bounds:', { minX, minY, maxX, maxY });
        
        // Check coordinate system
        const geoKeys = image.getGeoKeys();
        const crs = geoKeys?.GeographicTypeGeoKey || geoKeys?.ProjectedCSTypeGeoKey;
        console.log('🗺️ Coordinate system:', crs || 'Unknown');

        // GeoTIFF bbox is typically [minX, minY, maxX, maxY]
        // MapLibre expects coordinates as [lng, lat] pairs
        const coordinates = [
            [minX, maxY], // top-left [lng, lat]
            [maxX, maxY], // top-right [lng, lat]
            [maxX, minY], // bottom-right [lng, lat]
            [minX, minY]  // bottom-left [lng, lat]
        ];

        // Read the raster data
        console.log('📊 Reading raster data...');
        const rasters = await image.readRasters();
        const width = image.getWidth();
        const height = image.getHeight();
        const numBands = rasters.length;
        
        console.log(`✅ GeoTIFF loaded: ${width}x${height} pixels, ${numBands} band(s)`);

        // Create canvas to convert raster data to image
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(width, height);

        // Process bands for RGB display
        let rBand, gBand, bBand;
        
        if (bandIndices && bandIndices.length === 3) {
            // Use specified band indices
            rBand = rasters[bandIndices[0]];
            gBand = rasters[bandIndices[1]];
            bBand = rasters[bandIndices[2]];
            console.log(`🎨 Using bands ${bandIndices[0]}, ${bandIndices[1]}, ${bandIndices[2]} for RGB`);
        } else if (numBands >= 3) {
            // Use first 3 bands as RGB
            rBand = rasters[0];
            gBand = rasters[1];
            bBand = rasters[2];
            console.log('🎨 Using bands 0, 1, 2 for RGB');
        } else if (numBands === 1) {
            // Single band - use grayscale
            rBand = gBand = bBand = rasters[0];
            console.log('🎨 Single band - converting to grayscale');
        } else {
            console.warn('⚠️ Unexpected number of bands, using first band as grayscale');
            rBand = gBand = bBand = rasters[0];
        }

        // Normalize and convert to RGB
        let min, max;
        if (minMaxValues) {
            min = minMaxValues.min;
            max = minMaxValues.max;
            console.log(`📏 Using custom min/max: ${min} / ${max}`);
        } else {
            // Find min/max for normalization
            const allValues = [...rBand, ...gBand, ...bBand];
            min = Math.min(...allValues);
            max = Math.max(...allValues);
            console.log(`📏 Auto-calculated min/max: ${min.toFixed(2)} / ${max.toFixed(2)}`);
        }
        
        const range = max - min || 1; // Avoid division by zero

        // Fill image data
        console.log('🖼️ Converting to image...');
        for (let i = 0; i < width * height; i++) {
            const r = Math.max(0, Math.min(255, Math.round(((rBand[i] - min) / range) * 255)));
            const g = Math.max(0, Math.min(255, Math.round(((gBand[i] - min) / range) * 255)));
            const b = Math.max(0, Math.min(255, Math.round(((bBand[i] - min) / range) * 255)));
            
            const idx = i * 4;
            imageData.data[idx] = r;     // Red
            imageData.data[idx + 1] = g; // Green
            imageData.data[idx + 2] = b; // Blue
            imageData.data[idx + 3] = 255; // Alpha (fully opaque)
        }

        ctx.putImageData(imageData, 0, 0);
        console.log('✅ Image data converted');

        // Convert canvas to data URL
        const dataUrl = canvas.toDataURL('image/png');
        console.log('✅ Canvas converted to data URL');

        // Remove existing source/layer if present
        if (mapInstance.getSource(sourceId)) {
            mapInstance.removeSource(sourceId);
        }
        if (mapInstance.getLayer(layerId)) {
            mapInstance.removeLayer(layerId);
        }

        // Add image source with coordinates
        mapInstance.addSource(sourceId, {
            type: 'image',
            url: dataUrl,
            coordinates: coordinates
        });

        // Add raster layer
        mapInstance.addLayer({
            id: layerId,
            type: 'raster',
            source: sourceId,
            paint: {
                'raster-opacity': opacity,
                'raster-resampling': 'linear'
            }
        }, insertBeforeLayer);

        console.log('✅ GeoTIFF layer added to map successfully!');
        console.log('📍 Display bounds:', coordinates);
        
        return {
            success: true,
            bounds: { minX, minY, maxX, maxY },
            dimensions: { width, height },
            bands: numBands
        };

    } catch (error) {
        console.error('❌ Error loading GeoTIFF:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        return {
            success: false,
            error: error.message
        };
    }
}

