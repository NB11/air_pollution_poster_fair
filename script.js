let map;

// Initialize map
function initMap() {
    map = new maplibregl.Map({
        container: 'map-view',
        style: {
            version: 8,
            sources: {
                'osm-tiles': {
                    type: 'raster',
                    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                    tileSize: 256,
                    attribution: '© OpenStreetMap contributors'
                },
                'satellite-tiles': {
                    type: 'raster',
                    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
                    tileSize: 256,
                    attribution: '© Esri'
                }
            },
            layers: [
                {
                    id: 'satellite-layer',
                    type: 'raster',
                    source: 'satellite-tiles',
                    minzoom: 0,
                    maxzoom: 19
                }
            ]
        },
        center: [11.34, 44.49], // Center on Bologna
        zoom: 11, // Initial zoom level to show Bologna detail
        minZoom: 0, // Minimum zoom level - allows zooming out to see global context
        maxZoom: 16.4, // MAXIMUM ZOOM LIMIT - Change this value to adjust how far users can zoom in (higher = more zoom)
        antialias: false // Disable antialiasing to preserve raw pixels
    });

    // Add custom base map switcher control first (will be on top)
    addBaseMapSwitcher();
    
    // Add navigation controls (will be below switcher)
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    // Scale bar removed on desktop - can be re-enabled if needed
    // map.addControl(new maplibregl.ScaleControl(), 'top-right');

    // Wait for map to load before adding data
    map.on('load', () => {
        
        setupEventHandlers();
        // Load predicted raster layer with pollutant, year, and month selector
        initCompositeLayer();
        // Initialize mobile tab switcher
        initMobileTabSwitcher();
        initMobileInfoCarousel();
        // Initialize desktop tab switcher and location selector
        initDesktopTabSwitcher();
        initDesktopLocationSelector();
        // Optional: Load small tile (comment out if not needed)
        // loadPNGRasterLayer('map/s2/SALT_LAKE_CITY_2023_large_2023_01_S2_tile_x0_y0.png', 
        //                   'map/s2/SALT_LAKE_CITY_2023_large_2023_01_S2_tile_x0_y0_bounds.json');
    });
    
    // Initialize carousel when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initExplanationCarousel);
    } else {
        initExplanationCarousel();
    }
}

// Calculate polygon area to determine winding order
function calculatePolygonArea(ring) {
    let area = 0;
    for (let i = 0; i < ring.length - 1; i++) {
        area += ring[i][0] * ring[i + 1][1];
        area -= ring[i + 1][0] * ring[i][1];
    }
    return area / 2;
}

// Ensure ring is counter-clockwise (positive area)
function ensureCounterClockwise(ring) {
    const area = calculatePolygonArea(ring);
    return area > 0 ? ring : ring.reverse();
}

// Ensure ring is clockwise (negative area) - for holes
function ensureClockwise(ring) {
    const area = calculatePolygonArea(ring);
    return area < 0 ? ring : ring.reverse();
}

// Create inverse polygon (world minus Sahara) for masking
function createInversePolygon(saharaGeoJSON) {
    // Create a world polygon covering the entire globe (counter-clockwise)
    const worldPolygon = [
        [-180, -90],
        [-180, 90],
        [180, 90],
        [180, -90],
        [-180, -90]
    ];
    
    // Extract Sahara polygons as holes (must be clockwise)
    const holes = [];
    saharaGeoJSON.features.forEach(feature => {
        if (feature.geometry.type === 'MultiPolygon') {
            feature.geometry.coordinates.forEach(polygon => {
                // First ring of each polygon is the outer boundary
                polygon.forEach((ring, index) => {
                    if (index === 0) {
                        // Ensure clockwise for hole
                        const holeRing = ensureClockwise([...ring]);
                        holes.push(holeRing);
                    }
                });
            });
        } else if (feature.geometry.type === 'Polygon') {
            // First ring is outer boundary - make it clockwise for hole
            const holeRing = ensureClockwise([...feature.geometry.coordinates[0]]);
            holes.push(holeRing);
        }
    });
    
    return {
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: [worldPolygon, ...holes]
            },
            properties: {}
        }]
    };
}

// Load Sahara GeoJSON data
async function loadSaharaGeoJSON() {
    try {
        const response = await fetch('Sahara desert.geojson');
        const geoJsonData = await response.json();
        
        // Transform coordinates from EPSG:3857 to WGS84 if needed
        const transformedGeoJSON = transformGeoJSON(geoJsonData);
        
        // Remove existing sources/layers if present
        if (map.getLayer('world-mask')) {
            map.removeLayer('world-mask');
        }
        if (map.getSource('sahara-source')) {
            map.removeSource('sahara-source');
        }
        if (map.getSource('world-mask-source')) {
            map.removeSource('world-mask-source');
        }
        
        // Add Sahara source (for interactions only)
        map.addSource('sahara-source', {
            type: 'geojson',
            data: transformedGeoJSON
        });
        
        // Calculate bounds and set as maxBounds to restrict panning
        const bounds = new maplibregl.LngLatBounds();
        transformedGeoJSON.features.forEach(feature => {
            if (feature.geometry.type === 'MultiPolygon') {
                feature.geometry.coordinates.forEach(polygon => {
                    polygon.forEach(ring => {
                        ring.forEach(coord => {
                            bounds.extend(coord);
                        });
                    });
                });
            } else if (feature.geometry.type === 'Polygon') {
                feature.geometry.coordinates.forEach(ring => {
                    ring.forEach(coord => {
                        bounds.extend(coord);
                    });
                });
            }
        });
        
        // Expand bounds by approximately 1000km (about 9 degrees)
        const expandedBounds = new maplibregl.LngLatBounds(
            [bounds.getWest() - 9, bounds.getSouth() - 9],
            [bounds.getEast() + 9, bounds.getNorth() + 9]
        );
        
        // Remove maxBounds restriction - allow free panning
        // map.setMaxBounds(expandedBounds);
        
        // Don't fit bounds to Sahara - keep Salt Lake City view
        // fitSaharaBounds(transformedGeoJSON);
        
        // Load ALOS PALSAR raster layer if available
        loadALOSRaster();
        
    } catch (error) {
        console.error('Error loading Sahara GeoJSON:', error);
        alert('Error loading Sahara desert data. Please check the console for details.');
    }
}

// Composite layer management
let currentCity = 'Bologna'; // Default city
let currentCompositeYear = '2024';
let currentCompositeMonth = '01'; // Default to January
let currentPollutant = 'PM10'; // Default pollutant

// Available pollutants
const pollutants = ['NO2', 'O3', 'PM2.5', 'PM10', 'CTRL'];

// Pollutant color bar info (vmin, vmax)
const pollutantInfo = {
    'NO2': { vmin: 0, vmax: 50 },
    'O3': { vmin: 20, vmax: 80 },
    'SO2': { vmin: 0, vmax: 10 },
    'PM2.5': { vmin: 0, vmax: 35 },
    'PM10': { vmin: 0, vmax: 50 },
    'CTRL': { vmin: 0, vmax: 0 }
};

// Update color bar legend (shows min and max)
function updateColorBar(pollutant) {
    const info = pollutantInfo[pollutant] || pollutantInfo['NO2'];
    
    const minEl = document.getElementById('colorbar-min');
    const maxEl = document.getElementById('colorbar-max');
    const desktopMinEl = document.getElementById('desktop-colorbar-min');
    const desktopMaxEl = document.getElementById('desktop-colorbar-max');
    
    if (minEl) minEl.textContent = info.vmin;
    if (maxEl) maxEl.textContent = info.vmax;
    if (desktopMinEl) desktopMinEl.textContent = info.vmin;
    if (desktopMaxEl) desktopMaxEl.textContent = info.vmax;
    
    // Hide color bar if N/A selected
    const colorbar = document.getElementById('mobile-colorbar');
    if (colorbar) {
        colorbar.style.display = (pollutant === 'CTRL') ? 'none' : 'flex';
    }
    
    const desktopColorbar = document.getElementById('desktop-colorbar');
    if (desktopColorbar) {
        desktopColorbar.style.display = (pollutant === 'CTRL') ? 'none' : 'flex';
    }
}

// All years to display (2018-2025)
const allYears = ['2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025'];

// Available years per city (only cities have specific year data)
const cityYearData = {
    'Bologna': ['2024', '2025'],
    'Milano': ['2024', '2025'],
    'Frascati': ['2024', '2025']
};

// Get available years for current city
function getAvailableYears() {
    if (currentCity && cityYearData[currentCity]) {
        return cityYearData[currentCity];
    }
    // Default: all years (for global/no city selected)
    return allYears;
}

// Update year dropdown options based on current city
function updateYearDropdownOptions(dropdown) {
    const availableYears = getAvailableYears();
    dropdown.innerHTML = allYears.map(year => {
        const isAvailable = availableYears.includes(year);
        const disabledClass = isAvailable ? '' : ' disabled';
        const disabledAttr = isAvailable ? '' : ' data-disabled="true"';
        return '<div class="year-option' + disabledClass + '" data-year="' + year + '"' + disabledAttr + '>' + year + '</div>';
    }).join('');
}

// Update all year dropdowns (called when city changes)
function updateAllYearDropdowns() {
    const yearDropdown = document.getElementById('desktop-year-dropdown');
    const mobileYearDropdown = document.getElementById('mobile-year-dropdown');
    
    if (yearDropdown) updateYearDropdownOptions(yearDropdown);
    if (mobileYearDropdown) updateYearDropdownOptions(mobileYearDropdown);
    
    // If current year is not available for new city, switch to first available year
    const availableYears = getAvailableYears();
    if (!availableYears.includes(currentCompositeYear)) {
        currentCompositeYear = availableYears[0] || '2024';
        // Update button text
        const yearSelector = document.getElementById('year-selector');
        const mobileYearBtn = document.getElementById('mobile-year-btn');
        if (yearSelector) yearSelector.textContent = currentCompositeYear;
        if (mobileYearBtn) mobileYearBtn.textContent = currentCompositeYear;
    }
}

// Available months per year (all 12 months for all available years)
const availableMonths = {
    '2018': ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'],
    '2019': ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'],
    '2020': ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'],
    '2021': ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'],
    '2022': ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'],
    '2023': ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'],
    '2024': ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']
};

// Initialize composite layer with year/month slider
function initCompositeLayer() {
    // Load default month (January) with default pollutant (PM10) for current city
    // Explicitly use PM10 to ensure correct default
    const defaultPollutant = 'PM10';
    console.log(`Initializing with pollutant: ${defaultPollutant}, currentPollutant variable: ${currentPollutant}`);
    loadPredictedLayer(currentCompositeYear, '01', defaultPollutant);
    
    // Store references to all dropdowns for closing
    let allDropdowns = [];
    // Store original slider labels to restore later
    const monthLabels = document.querySelector('.month-slider-labels');
    const mobileMonthLabels = document.querySelector('.mobile-month-slider-labels');
    const originalMonthLabelsHTML = monthLabels ? monthLabels.innerHTML : null;
    const originalMobileMonthLabelsHTML = mobileMonthLabels ? mobileMonthLabels.innerHTML : null;
    
    // Function to close all dropdowns
    function closeAllDropdowns() {
        allDropdowns.forEach(dropdown => {
            if (dropdown && dropdown.style) {
                dropdown.style.display = 'none';
            }
        });
    }
    
    // Set up pollutant selector button (desktop)
    const pollutantSelector = document.getElementById('pollutant-selector');
    if (pollutantSelector) {
        // Create pollutant dropdown menu
        const pollutantDropdown = document.createElement('div');
        pollutantDropdown.className = 'year-dropdown';
        pollutantDropdown.style.display = 'none';
        pollutantDropdown.innerHTML = pollutants.map(p => 
            `<div class="year-option" data-pollutant="${p}">${p}</div>`
        ).join('');
        document.body.appendChild(pollutantDropdown);
        allDropdowns.push(pollutantDropdown);
        
        pollutantSelector.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = pollutantDropdown.style.display === 'block';
            
            // Close all other dropdowns first
            closeAllDropdowns();
            
            // Toggle this dropdown
            pollutantDropdown.style.display = isVisible ? 'none' : 'block';
            
            if (!isVisible) {
                // Position dropdown - open upwards if more space above than below
                const rect = pollutantSelector.getBoundingClientRect();
                const spaceBelow = window.innerHeight - rect.bottom;
                const spaceAbove = rect.top;
                
                pollutantDropdown.style.position = 'fixed';
                pollutantDropdown.style.left = `${rect.left}px`;
                pollutantDropdown.style.width = `${rect.width}px`;
                pollutantDropdown.style.zIndex = '10000';
                
                // Estimate dropdown height (number of options * ~35px per option + padding)
                const estimatedHeight = pollutants.length * 35 + 10;
                
                if (spaceBelow < estimatedHeight && spaceAbove > spaceBelow) {
                    // Open upwards
                    pollutantDropdown.style.bottom = `${window.innerHeight - rect.top + 5}px`;
                    pollutantDropdown.style.top = 'auto';
                } else {
                    // Open downwards
                    pollutantDropdown.style.top = `${rect.bottom + 5}px`;
                    pollutantDropdown.style.bottom = 'auto';
                }
            }
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!pollutantSelector.contains(e.target) && !pollutantDropdown.contains(e.target)) {
                closeAllDropdowns();
            }
        });
        
        // Handle pollutant selection
        pollutantDropdown.addEventListener('click', (e) => {
            if (e.target.classList.contains('year-option')) {
                const pollutant = e.target.getAttribute('data-pollutant');
                currentPollutant = pollutant;
                pollutantSelector.textContent = pollutant;
                pollutantDropdown.style.display = 'none';
                updateColorBar(pollutant);
                
                // Reload layer with new pollutant
                loadPredictedLayer(currentCompositeYear, currentCompositeMonth, pollutant, {
                    originalMonthLabelsHTML,
                    originalMobileMonthLabelsHTML
                });
                
                // Load ground stations for new pollutant
                const monthNum = parseInt(currentCompositeMonth || '1');
                loadGroundStations(pollutant, currentCompositeYear, monthNum);
            }
        });
    }
    
    // Set up mobile pollutant button
    const mobilePollutantBtn = document.getElementById('mobile-pollutant-btn');
    if (mobilePollutantBtn) {
        // Create mobile pollutant dropdown
        const mobilePollutantDropdown = document.createElement('div');
        mobilePollutantDropdown.className = 'year-dropdown';
        mobilePollutantDropdown.style.display = 'none';
        mobilePollutantDropdown.innerHTML = pollutants.map(p => 
            `<div class="year-option" data-pollutant="${p}">${p}</div>`
        ).join('');
        document.body.appendChild(mobilePollutantDropdown);
        allDropdowns.push(mobilePollutantDropdown);
        
        mobilePollutantBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = mobilePollutantDropdown.style.display === 'block';
            
            // Close all other dropdowns first
            closeAllDropdowns();
            
            // Toggle this dropdown
            mobilePollutantDropdown.style.display = isVisible ? 'none' : 'block';
            
            if (!isVisible) {
                // Position dropdown - open upwards if more space above than below
                const rect = mobilePollutantBtn.getBoundingClientRect();
                const spaceBelow = window.innerHeight - rect.bottom;
                const spaceAbove = rect.top;
                
                mobilePollutantDropdown.style.position = 'fixed';
                mobilePollutantDropdown.style.left = `${rect.left}px`;
                mobilePollutantDropdown.style.width = `${rect.width}px`;
                mobilePollutantDropdown.style.zIndex = '10000';
                
                // Estimate dropdown height (number of options * ~35px per option + padding)
                const estimatedHeight = pollutants.length * 35 + 10;
                
                if (spaceBelow < estimatedHeight && spaceAbove > spaceBelow) {
                    // Open upwards
                    mobilePollutantDropdown.style.bottom = `${window.innerHeight - rect.top + 5}px`;
                    mobilePollutantDropdown.style.top = 'auto';
                } else {
                    // Open downwards
                    mobilePollutantDropdown.style.top = `${rect.bottom + 5}px`;
                    mobilePollutantDropdown.style.bottom = 'auto';
                }
            }
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!mobilePollutantBtn.contains(e.target) && !mobilePollutantDropdown.contains(e.target)) {
                closeAllDropdowns();
            }
        });
        
        // Handle pollutant selection
        mobilePollutantDropdown.addEventListener('click', (e) => {
            if (e.target.classList.contains('year-option')) {
                const pollutant = e.target.getAttribute('data-pollutant');
                currentPollutant = pollutant;
                mobilePollutantBtn.textContent = pollutant;
                mobilePollutantDropdown.style.display = 'none';
                updateColorBar(pollutant);
                
                // Update desktop selector if it exists
                if (pollutantSelector) {
                    pollutantSelector.textContent = pollutant;
                }
                
                // Reload layer with new pollutant
                loadPredictedLayer(currentCompositeYear, currentCompositeMonth, pollutant, {
                    originalMonthLabelsHTML,
                    originalMobileMonthLabelsHTML
                });
            }
        });
    }
    
    // Set up mobile year button
    const mobileYearBtn = document.getElementById('mobile-year-btn');
    if (mobileYearBtn) {
        // Create mobile year dropdown
        const mobileYearDropdown = document.createElement('div');
        mobileYearDropdown.className = 'year-dropdown';
        mobileYearDropdown.id = 'mobile-year-dropdown';
        mobileYearDropdown.style.display = 'none';
        // Generate year options with strikethrough for unavailable years
        updateYearDropdownOptions(mobileYearDropdown);
        document.body.appendChild(mobileYearDropdown);
        allDropdowns.push(mobileYearDropdown);
        
        mobileYearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = mobileYearDropdown.style.display === 'block';
            
            // Close all other dropdowns first
            closeAllDropdowns();
            
            // Toggle this dropdown
            mobileYearDropdown.style.display = isVisible ? 'none' : 'block';
            
            if (!isVisible) {
                // Position dropdown - open upwards if more space above than below
                const rect = mobileYearBtn.getBoundingClientRect();
                const spaceBelow = window.innerHeight - rect.bottom;
                const spaceAbove = rect.top;
                
                mobileYearDropdown.style.position = 'fixed';
                mobileYearDropdown.style.left = `${rect.left}px`;
                mobileYearDropdown.style.width = `${rect.width}px`;
                mobileYearDropdown.style.zIndex = '10000';
                
                // Estimate dropdown height (8 options * ~30px + padding)
                const estimatedHeight = 250;
                
                if (spaceBelow < estimatedHeight && spaceAbove > spaceBelow) {
                    // Open upwards
                    mobileYearDropdown.style.bottom = `${window.innerHeight - rect.top + 5}px`;
                    mobileYearDropdown.style.top = 'auto';
                } else {
                    // Open downwards
                    mobileYearDropdown.style.top = `${rect.bottom + 5}px`;
                    mobileYearDropdown.style.bottom = 'auto';
                }
            }
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!mobileYearBtn.contains(e.target) && !mobileYearDropdown.contains(e.target)) {
                closeAllDropdowns();
            }
        });
        
        // Handle year selection
        mobileYearDropdown.addEventListener('click', (e) => {
            if (e.target.classList.contains('year-option') && !e.target.classList.contains('disabled')) {
                const year = e.target.getAttribute('data-year');
                if (getAvailableYears().includes(year)) {
                    currentCompositeYear = year;
                    mobileYearBtn.textContent = year;
                    mobileYearDropdown.style.display = 'none';
                    
                    // Update desktop year selector if it exists
                    const yearSelector = document.getElementById('year-selector');
                    if (yearSelector) {
                        yearSelector.textContent = year;
                    }
                    
                    // Reload layer with new year
                    loadPredictedLayer(year, currentCompositeMonth, currentPollutant);
                }
            }
        });
    }
    
    // Set up year selector button
    const yearSelector = document.getElementById('year-selector');
    if (yearSelector) {
        // Create year dropdown menu
        const yearDropdown = document.createElement('div');
        yearDropdown.className = 'year-dropdown';
        yearDropdown.id = 'desktop-year-dropdown';
        yearDropdown.style.display = 'none';
        // Generate year options with strikethrough for unavailable years
        updateYearDropdownOptions(yearDropdown);
        document.body.appendChild(yearDropdown);
        allDropdowns.push(yearDropdown);
        
        yearSelector.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = yearDropdown.style.display === 'block';
            
            // Close all other dropdowns first
            closeAllDropdowns();
            
            // Toggle this dropdown
            yearDropdown.style.display = isVisible ? 'none' : 'block';
            
            if (!isVisible) {
                // Position dropdown - open upwards if more space above than below
                const rect = yearSelector.getBoundingClientRect();
                const spaceBelow = window.innerHeight - rect.bottom;
                const spaceAbove = rect.top;
                
                yearDropdown.style.position = 'fixed';
                yearDropdown.style.left = `${rect.left}px`;
                yearDropdown.style.width = `${rect.width}px`;
                yearDropdown.style.zIndex = '10000';
                
                // Estimate dropdown height (8 options * ~30px + padding)
                const estimatedHeight = 250;
                
                if (spaceBelow < estimatedHeight && spaceAbove > spaceBelow) {
                    // Open upwards
                    yearDropdown.style.bottom = `${window.innerHeight - rect.top + 5}px`;
                    yearDropdown.style.top = 'auto';
                } else {
                    // Open downwards
                    yearDropdown.style.top = `${rect.bottom + 5}px`;
                    yearDropdown.style.bottom = 'auto';
                }
            }
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!yearSelector.contains(e.target) && !yearDropdown.contains(e.target)) {
                closeAllDropdowns();
            }
        });
        
        // Handle year selection
        yearDropdown.addEventListener('click', (e) => {
            if (e.target.classList.contains('year-option') && !e.target.classList.contains('disabled')) {
                const year = e.target.getAttribute('data-year');
                if (getAvailableYears().includes(year)) {
                    currentCompositeYear = year;
                    yearSelector.textContent = year;
                    yearDropdown.style.display = 'none';
                    
                    // Update mobile year button if it exists
                    const mobileYearBtn = document.getElementById('mobile-year-btn');
                    if (mobileYearBtn) {
                        mobileYearBtn.textContent = year;
                    }
                    
                    // Update sliders - keep max at 12 (all months)
                    const monthSlider = document.getElementById('month-slider');
                    const mobileMonthSlider = document.getElementById('mobile-month-slider');
                    
                    // If current month is not available, reset to first available
                    if (availableMonths[year] && !availableMonths[year].includes(currentCompositeMonth)) {
                        currentCompositeMonth = availableMonths[year][0];
                        const firstMonthNum = parseInt(currentCompositeMonth);
                        
                        if (monthSlider) {
                            monthSlider.value = firstMonthNum;
                        }
                        if (mobileMonthSlider) {
                            mobileMonthSlider.value = firstMonthNum;
                        }
                    } else {
                        // Sync both sliders with current month
                        const currentMonthNum = parseInt(currentCompositeMonth);
                        if (monthSlider) {
                            monthSlider.value = currentMonthNum;
                        }
                        if (mobileMonthSlider) {
                            mobileMonthSlider.value = currentMonthNum;
                        }
                    }
                    
                    // Reload current month with new year
                    loadPredictedLayer(year, currentCompositeMonth, currentPollutant);
                }
            }
        });
    }
    
    // Set up month slider (desktop)
    const monthSlider = document.getElementById('month-slider');
    const monthDisplay = document.getElementById('month-display');
    
    // Set up mobile month slider
    const mobileMonthSlider = document.getElementById('mobile-month-slider');
    
    // Function to handle month change
    function handleMonthChange(monthNum, sourceSlider) {
        // CTRL mode: slider controls opacity 0-100%
        if (currentPollutant === 'CTRL') {
            const opacity = Math.max(0, Math.min(100, monthNum));
            // Sync both sliders
            if (monthSlider && sourceSlider !== monthSlider) {
                monthSlider.value = opacity;
            }
            if (mobileMonthSlider && sourceSlider !== mobileMonthSlider) {
                mobileMonthSlider.value = opacity;
            }
            setCurrentLayerOpacity(opacity / 100);
            return;
        }

        // Normal mode: month selection
        const monthStr = String(monthNum).padStart(2, '0');
        
        // Sync both sliders
        if (monthSlider && sourceSlider !== monthSlider) {
            monthSlider.value = monthNum;
        }
        if (mobileMonthSlider && sourceSlider !== mobileMonthSlider) {
            mobileMonthSlider.value = monthNum;
        }
        
        // If layers are already preloaded for this pollutant, just switch visibility (instant)
        if (loadedPollutant === currentPollutant && loadedYear === currentCompositeYear) {
            showMonth(monthNum);
            // Load ground stations for new month
            loadGroundStations(currentPollutant, currentCompositeYear, monthNum);
        } else {
            // Otherwise load the predicted layer (will preload all months)
            loadPredictedLayer(currentCompositeYear, monthStr, currentPollutant);
            // Load ground stations for new month
            loadGroundStations(currentPollutant, currentCompositeYear, monthNum);
        }
    }
    
    if (monthSlider) {
        // Set max to 12 (all months) - slider can slide through all months
        monthSlider.max = 12;
        monthSlider.min = 1;
        monthSlider.step = 1;
        
        // Update when slider changes
        monthSlider.addEventListener('input', (e) => {
            const monthNum = parseInt(e.target.value);
            handleMonthChange(monthNum, monthSlider);
        });
    }
    
    if (mobileMonthSlider) {
        // Set max to 12 (all months) - slider can slide through all months
        mobileMonthSlider.max = 12;
        mobileMonthSlider.min = 1;
        mobileMonthSlider.step = 1;
        
        // Sync initial value with desktop slider
        if (monthSlider) {
            mobileMonthSlider.value = monthSlider.value;
        }
        
        // Update when slider changes
        mobileMonthSlider.addEventListener('input', (e) => {
            const monthNum = parseInt(e.target.value);
            handleMonthChange(monthNum, mobileMonthSlider);
        });
    }
}

// Track which pollutant's layers are currently loaded
let loadedPollutant = null;
let loadedYear = null;
let loadedMonth = null;
// Track current opacity (shared across modes) - default 90%
let ctrlOpacity = 0.9;
// Cache for bounds data (avoids repeated fetches)
let cachedBoundsCoords = null;
let cachedBoundsKey = null;

// Lazy load a single month's layer on demand (memory efficient)
async function loadMonthLayer(year, month, pollutant) {
    // If we're in CTRL mode or N/A, skip loading
    if (pollutant === 'CTRL' || pollutant === 'N/A') {
        return;
    }
    
    const monthStr = String(month).padStart(2, '0');
    const sourceId = 'predicted-source-current';
    const layerId = 'predicted-layer-current';
    
    // Check if this exact layer is already loaded
    if (loadedPollutant === pollutant && loadedYear === year && loadedMonth === monthStr) {
        console.log(`📅 Layer already loaded for ${pollutant} ${year}-${monthStr}`);
        return;
    }
    
    // Remove previous layer if exists
    if (map.getLayer(layerId)) {
        map.removeLayer(layerId);
    }
    if (map.getSource(sourceId)) {
        map.removeSource(sourceId);
    }
    
    // Format pollutant name for folder/filename (PM2.5 becomes PM2_5)
    const pollutantFileName = pollutant.replace('.', '_');
    
    // Build paths for bounds and image (WebP format)
    // Using consolidated bounds.json instead of individual *_bounds.geojson files
    let boundsPath, imagePath;
    if (currentCity) {
        boundsPath = `map/predicted/${currentCity}/${year}/bounds.json`;
        imagePath = `map/predicted/${currentCity}/${year}/${pollutantFileName}_month${monthStr}_inferno.webp`;
    } else {
        boundsPath = `map/predicted/${year}/bounds.json`;
        imagePath = `map/predicted/${year}/${pollutantFileName}_month${monthStr}_inferno.webp`;
    }
    
    console.log(`📅 Constructed image path: ${imagePath} for pollutant: ${pollutant}`);
    
    // Cache key for bounds (now per city/year, not per pollutant)
    const boundsKey = `${currentCity || 'default'}-${year}`;
    
    // Load bounds (use cache if available)
    let boundsCoords = null;
    if (cachedBoundsKey === boundsKey && cachedBoundsCoords) {
        boundsCoords = cachedBoundsCoords;
    } else {
        try {
            const boundsResponse = await fetch(boundsPath);
            if (boundsResponse.ok) {
                const boundsData = await boundsResponse.json();
                // New consolidated format: coordinates is an array of [lon, lat] pairs
                const coordinates = boundsData.coordinates;
                boundsCoords = [
                    coordinates[0], // top-left [lon, lat]
                    coordinates[1], // top-right [lon, lat]
                    coordinates[2], // bottom-right [lon, lat]
                    coordinates[3]  // bottom-left [lon, lat]
                ];
                // Cache the bounds
                cachedBoundsCoords = boundsCoords;
                cachedBoundsKey = boundsKey;
            }
        } catch (error) {
            console.error('Failed to load bounds:', error);
            return;
        }
    }
    
    if (!boundsCoords) {
        console.error('Could not load bounds for', pollutant);
        return;
    }
    
    console.log(`📅 Loading ${pollutant} ${year}-${monthStr}...`);
    
    try {
        // Add image source (WebP)
        map.addSource(sourceId, {
            type: 'image',
            url: imagePath,
            coordinates: boundsCoords
        });
        
        // Add layer with current opacity - add BEFORE ground stations so they stay on top
        const layerConfig = {
            id: layerId,
            type: 'raster',
            source: sourceId,
            paint: {
                'raster-opacity': ctrlOpacity
            }
        };
        
        // Add before ground stations layer so stations remain visible on top
        if (map.getLayer('ground-stations-layer')) {
            map.addLayer(layerConfig, 'ground-stations-layer');
        } else if (map.getLayer('all-stations-layer')) {
            map.addLayer(layerConfig, 'all-stations-layer');
        } else {
            map.addLayer(layerConfig);
        }
        
        loadedPollutant = pollutant;
        loadedYear = year;
        loadedMonth = monthStr;
        console.log(`  ✓ Loaded ${pollutant} ${year}-${monthStr}`);
    } catch (error) {
        console.error(`  ✗ Failed to load ${pollutant} ${year}-${monthStr}:`, error);
    }
}

// Show the selected month's layer (lazy loads on demand)
async function showMonth(month) {
    const monthStr = String(month).padStart(2, '0');
    currentCompositeMonth = monthStr;
    
    // Lazy load the layer for this month
    await loadMonthLayer(currentCompositeYear, month, currentPollutant);
    
    console.log(`📅 Showing month ${monthStr}`);
}

// Set opacity for the currently visible layer
function setCurrentLayerOpacity(opacity) {
    ctrlOpacity = Math.max(0, Math.min(1, opacity));
    const layerId = 'predicted-layer-current';
    if (map.getLayer(layerId)) {
        map.setPaintProperty(layerId, 'raster-opacity', ctrlOpacity);
    }
}

// Load authors/acknowledgements content from external HTML
function loadAuthorsContent() {
    fetch('texts/authors.html')
        .then(resp => resp.text())
        .then(html => {
            const desktop = document.getElementById('authors-slide');
            const mobile = document.getElementById('authors-mobile');
            if (desktop) desktop.innerHTML = html;
            if (mobile) mobile.innerHTML = html;
        })
        .catch(err => console.error('Failed to load authors content:', err));
}

// Load per-slide HTML snippets into desktop and mobile carousels
function loadSlideHTML() {
    const sections = [
        { path: 'texts/introduction.html', targets: ['slide-introduction', 'mobile-slide-introduction'] },
        { path: 'texts/data-collection.html', targets: ['slide-data-collection', 'mobile-slide-data-collection'] },
        { path: 'texts/model.html', targets: ['slide-model', 'mobile-slide-model'] },
        { path: 'texts/results.html', targets: ['slide-results', 'mobile-slide-results'] }
    ];

    let loadedCount = 0;
    const totalSections = sections.length;

    sections.forEach(section => {
        fetch(section.path)
            .then(resp => resp.text())
            .then(html => {
                section.targets.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.innerHTML = html;
                });
                // Initialize toggle button after data-collection HTML is loaded
                if (section.path === 'texts/data-collection.html') {
                    initAllStationsToggle();
                }
                
                loadedCount++;
                // Setup arrow listeners after all slides are loaded
                if (loadedCount === totalSections) {
                    setTimeout(() => {
                        setupArrowListeners();
                        if (typeof updateArrowVisibility === 'function') {
                            updateArrowVisibility();
                        }
                    }, 100);
                }
            })
            .catch(err => console.error(`Failed to load ${section.path}:`, err));
    });
}

// Load references content into the info popup
function loadReferencesContent() {
    fetch('texts/references.html')
        .then(resp => resp.text())
        .then(html => {
            const container = document.getElementById('references-content');
            if (container) container.innerHTML = html;
        })
        .catch(err => console.error('Failed to load references content:', err));
}

// Enable collapse/expand for the desktop explanation widget
function initExplanationCollapse() {
    const widget = document.querySelector('.explanation-widget');
    const btn = document.getElementById('explanation-collapse');
    const collapsedButtons = document.querySelectorAll('.collapsed-title-btn');
    if (!widget || !btn) return;
    
    // Set initial button text based on collapsed state
    btn.textContent = widget.classList.contains('collapsed') ? '›' : '‹';
    
    btn.addEventListener('click', () => {
        widget.classList.toggle('collapsed');
        btn.textContent = widget.classList.contains('collapsed') ? '›' : '‹';
    });

    // Clicking a collapsed title should expand and jump to that slide
    collapsedButtons.forEach((cbtn) => {
        cbtn.addEventListener('click', () => {
            const slideIdx = parseInt(cbtn.getAttribute('data-slide'), 10);
            // expand
            widget.classList.remove('collapsed');
            btn.textContent = '‹';
            // Navigate to slide
            if (window.innerWidth >= 769) {
                // Desktop: use goToSlide function
                if (window.goToSlideDesktop) {
                    window.goToSlideDesktop(slideIdx);
                }
            } else {
                // Mobile: use indicators
                const indicators = document.querySelectorAll('.indicator');
                if (indicators && indicators[slideIdx]) {
                    indicators[slideIdx].click();
                }
            }
        });
    });
}

// Load predicted layer - preloads all months then shows selected
async function loadPredictedLayer(year, month, pollutant, sliderLabelState = {}) {
    currentCompositeYear = year;
    currentCompositeMonth = month;
    currentPollutant = pollutant;
    
    // Update color bar legend
    updateColorBar(pollutant);

    // Helper to switch slider to opacity mode
    function setSliderToOpacityMode() {
        const monthSlider = document.getElementById('month-slider');
        const mobileMonthSlider = document.getElementById('mobile-month-slider');
        const monthLabels = document.querySelector('.month-slider-labels');
        const mobileMonthLabels = document.querySelector('.mobile-month-slider-labels');

        if (monthSlider) {
            monthSlider.min = 0;
            monthSlider.max = 100;
            monthSlider.step = 1;
            monthSlider.value = Math.round(ctrlOpacity * 100);
        }
        if (mobileMonthSlider) {
            mobileMonthSlider.min = 0;
            mobileMonthSlider.max = 100;
            mobileMonthSlider.step = 1;
            mobileMonthSlider.value = Math.round(ctrlOpacity * 100);
        }
        // Replace labels with simple opacity ticks
        if (monthLabels) {
            monthLabels.innerHTML = '<span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>';
        }
        if (mobileMonthLabels) {
            mobileMonthLabels.innerHTML = '<span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>';
        }
    }

    // Helper to switch slider back to month mode
    function setSliderToMonthMode() {
        const monthSlider = document.getElementById('month-slider');
        const mobileMonthSlider = document.getElementById('mobile-month-slider');
        const monthLabels = document.querySelector('.month-slider-labels');
        const mobileMonthLabels = document.querySelector('.mobile-month-slider-labels');

        if (monthSlider) {
            monthSlider.min = 1;
            monthSlider.max = 12;
            monthSlider.step = 1;
            monthSlider.value = parseInt(currentCompositeMonth || '1');
        }
        if (mobileMonthSlider) {
            mobileMonthSlider.min = 1;
            mobileMonthSlider.max = 12;
            mobileMonthSlider.step = 1;
            mobileMonthSlider.value = parseInt(currentCompositeMonth || '1');
        }
        if (sliderLabelState.originalMonthLabelsHTML && monthLabels) {
            monthLabels.innerHTML = sliderLabelState.originalMonthLabelsHTML;
        }
        if (sliderLabelState.originalMobileMonthLabelsHTML && mobileMonthLabels) {
            mobileMonthLabels.innerHTML = sliderLabelState.originalMobileMonthLabelsHTML;
        }
    }

    // CTRL mode: slider becomes opacity control; do not reload layers
    if (pollutant === 'CTRL') {
        setSliderToOpacityMode();
        // Ensure currently visible layer is at correct opacity
        setCurrentLayerOpacity(ctrlOpacity);
        return;
    } else {
        // Restore month slider configuration when leaving CTRL
        setSliderToMonthMode();
        // Re-apply stored opacity when returning to normal mode
        setCurrentLayerOpacity(ctrlOpacity);
    }
    
    // Handle N/A pollutant - remove layer and show basemap only
    if (pollutant === 'N/A') {
        const layerId = 'predicted-layer-current';
        const sourceId = 'predicted-source-current';
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
        loadedPollutant = pollutant;
        console.log(`📅 No pollutant layer - showing basemap only`);
        return;
    }
    
    // Lazy load only the selected month (on demand)
    await loadMonthLayer(year, month, pollutant);
    
    // Load ground stations for the selected pollutant and month
    const monthNum = parseInt(month || '1');
    loadGroundStations(pollutant, year, monthNum);
}

// Legacy function for backward compatibility
async function loadCompositeLayer(year, month) {
    loadPredictedLayer(year, month, currentPollutant);
}

// Track if "show all stations" toggle is active
let showAllStationsEnabled = false;

// Load all ground stations (all pollutants, all months) - shows unique station locations
async function loadAllStations() {
    try {
        console.log('Loading all ground stations...');
        
        // Use consolidated station files (one per pollutant)
        const pollutants = ['NO2', 'O3', 'PM2.5', 'PM10'];
        
        // Collect all unique stations by station_id
        const stationMap = new Map();
        
        // Load consolidated files (4 files instead of hundreds)
        const loadPromises = pollutants.map(async (pollutant) => {
            const geojsonPath = `map/ground_truth_stations/stations_${pollutant}.geojson`;
            
            try {
                // Check cache first
                if (stationDataCache.has(pollutant)) {
                    console.log(`  Using cached ${pollutant} data`);
                    const geojsonData = stationDataCache.get(pollutant);
                    if (geojsonData && geojsonData.features) {
                        geojsonData.features.forEach(feature => {
                            const stationId = feature.properties.station_id;
                            if (!stationMap.has(stationId)) {
                                stationMap.set(stationId, feature);
                            }
                        });
                    }
                    return;
                }
                
                const resp = await fetch(geojsonPath);
                if (resp.ok) {
                    const geojsonData = await resp.json();
                    // Cache for future use
                    stationDataCache.set(pollutant, geojsonData);
                    
                    if (geojsonData && geojsonData.features) {
                        geojsonData.features.forEach(feature => {
                            const stationId = feature.properties.station_id;
                            // Use first occurrence of each station (or could merge data)
                            if (!stationMap.has(stationId)) {
                                stationMap.set(stationId, feature);
                            }
                        });
                        console.log(`  Loaded ${geojsonData.features.length} features from ${pollutant}, ${stationMap.size} unique stations so far`);
                    }
                }
            } catch (error) {
                console.warn(`  Failed to load ${pollutant} stations:`, error);
            }
        });
        
        await Promise.all(loadPromises);
        
        // Create combined GeoJSON
        const combinedGeoJSON = {
            type: 'FeatureCollection',
            features: Array.from(stationMap.values())
        };
        
        console.log(`Loaded ${combinedGeoJSON.features.length} unique ground stations from all pollutants and months`);
        
        // Remove existing source/layer if present
        if (map.getLayer('all-stations-layer')) {
            map.removeLayer('all-stations-layer');
        }
        if (map.getSource('all-stations-source')) {
            map.removeSource('all-stations-source');
        }
        
        // Add source
        map.addSource('all-stations-source', {
            type: 'geojson',
            data: combinedGeoJSON
        });
        
        // Add circle layer with neutral gray color
        map.addLayer({
            id: 'all-stations-layer',
            type: 'circle',
            source: 'all-stations-source',
            paint: {
                'circle-radius': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    6, 3,   // At zoom 6, radius 3
                    10, 5,  // At zoom 10, radius 5
                    14, 8   // At zoom 14, radius 8
                ],
                'circle-color': '#888888',  // Neutral gray
                'circle-stroke-width': 1,
                'circle-stroke-color': '#ffffff',
                'circle-opacity': 0.6
            }
        });
        
        // Add click handler for popups
        let popup = null;
        map.on('click', 'all-stations-layer', (e) => {
            if (popup) {
                popup.remove();
            }
            const feature = e.features[0];
            const props = feature.properties;
            
            popup = new maplibregl.Popup()
                .setLngLat(e.lngLat)
                .setHTML(`
                    <div style="font-family: 'Poppins', sans-serif; padding: 8px;">
                        <strong>Ground Station</strong><br>
                        Station ID: ${props.station_id.substring(0, 8)}...
                    </div>
                `)
                .addTo(map);
        });
        
        // Change cursor on hover
        map.on('mouseenter', 'all-stations-layer', () => {
            map.getCanvas().style.cursor = 'pointer';
        });
        
        map.on('mouseleave', 'all-stations-layer', () => {
            map.getCanvas().style.cursor = '';
        });
        
    } catch (error) {
        console.error('Error loading all ground stations:', error);
    }
}

// Initialize toggle button for showing all stations
function initAllStationsToggle() {
    const toggle = document.getElementById('show-all-stations-toggle');
    if (!toggle) return;
    
    toggle.addEventListener('change', (e) => {
        showAllStationsEnabled = e.target.checked;
        
        if (showAllStationsEnabled) {
            // Show all stations
            loadAllStations();
        } else {
            // Remove all stations layer and reload filtered stations
            if (map.getLayer('all-stations-layer')) {
                map.removeLayer('all-stations-layer');
            }
            if (map.getSource('all-stations-source')) {
                map.removeSource('all-stations-source');
            }
            // Reload filtered stations based on current selection
            const monthNum = parseInt(currentCompositeMonth || '1');
            loadGroundStations(currentPollutant, currentCompositeYear, monthNum);
        }
    });
}

// Cache for consolidated station data
const stationDataCache = new Map();

// Load ground station markers for selected pollutant and month
async function loadGroundStations(pollutant, year, month) {
    // Don't load filtered stations if "show all" toggle is enabled
    if (showAllStationsEnabled) {
        return;
    }
    // Skip if CTRL mode (no stations for control layer)
    if (pollutant === 'CTRL') {
        // Remove stations if switching to CTRL mode
        if (map.getLayer('ground-stations-layer')) {
            map.removeLayer('ground-stations-layer');
        }
        if (map.getSource('ground-stations-source')) {
            map.removeSource('ground-stations-source');
        }
        return;
    }
    
    // Format month as two digits
    const monthStr = String(month).padStart(2, '0');
    const periodKey = `${year}-${monthStr}`;
    
    // Try to load station predictions (with predicted values) first if we have a city selected
    let geojsonPath = null;
    let hasPredictions = false;
    let geojsonData = null;
    
    if (currentCity) {
        // Try prediction data with both ground truth and predicted values
        geojsonPath = `map/station_predictions/${currentCity}/${year}/stations_${pollutant}_${year}_${monthStr}.geojson`;
        hasPredictions = true;
    }
    
    try {
        console.log(`Loading ground stations for ${pollutant} ${year}-${monthStr}...`);
        
        let response = null;
        
        if (geojsonPath) {
            response = await fetch(geojsonPath);
        }
        
        // If prediction data doesn't exist, fall back to consolidated ground truth file
        if (!response || !response.ok) {
            hasPredictions = false;
            
            // Use consolidated station file (one file per pollutant with all months/years)
            const consolidatedPath = `map/ground_truth_stations/stations_${pollutant}.geojson`;
            
            // Check cache first
            if (stationDataCache.has(pollutant)) {
                console.log(`  Using cached ${pollutant} station data`);
                geojsonData = stationDataCache.get(pollutant);
            } else {
                console.log(`  Loading consolidated file: ${consolidatedPath}`);
                response = await fetch(consolidatedPath);
                
                if (response.ok) {
                    geojsonData = await response.json();
                    stationDataCache.set(pollutant, geojsonData);
                }
            }
            
            // Filter by period_key to get only the requested month/year
            if (geojsonData && geojsonData.features) {
                const filteredFeatures = geojsonData.features.filter(
                    f => f.properties.period_key === periodKey
                );
                geojsonData = {
                    type: 'FeatureCollection',
                    features: filteredFeatures
                };
                console.log(`  Filtered to ${filteredFeatures.length} stations for ${periodKey}`);
            }
        } else {
            geojsonData = await response.json();
        }
        
        if (!geojsonData || !geojsonData.features || geojsonData.features.length === 0) {
            // No data for this combination - remove existing stations
            if (map.getLayer('ground-stations-layer')) {
                map.removeLayer('ground-stations-layer');
            }
            if (map.getSource('ground-stations-source')) {
                map.removeSource('ground-stations-source');
            }
            console.log(`No ground station data available for ${pollutant} ${year}-${monthStr}`);
            return;
        }
        console.log(`  Loaded ${geojsonData.features.length} stations${hasPredictions ? ' (with predictions)' : ' (ground truth only)'}`);
        
        // Remove existing source/layer if present
        if (map.getLayer('ground-stations-layer')) {
            map.removeLayer('ground-stations-layer');
        }
        if (map.getSource('ground-stations-source')) {
            map.removeSource('ground-stations-source');
        }
        
        // Add source
        map.addSource('ground-stations-source', {
            type: 'geojson',
            data: geojsonData
        });
        
        // Add circle layer - simple black/white style
        map.addLayer({
            id: 'ground-stations-layer',
            type: 'circle',
            source: 'ground-stations-source',
            paint: {
                'circle-radius': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    6, 3,   // At zoom 6, radius 3
                    10, 5,  // At zoom 10, radius 5
                    14, 8   // At zoom 14, radius 8
                ],
                'circle-color': '#000000',  // Black circles
                'circle-stroke-width': 1,
                'circle-stroke-color': '#ffffff',
                'circle-opacity': 0.7
            }
        });
        
        console.log(`Loaded ${geojsonData.features.length} ground stations`);
        
        // Store popup instance to close it when needed
        let popup = null;
        
        // Conversion factors from ppb to µg/m³ (at 25°C, 1 atm)
        const ppbToUgPerM3 = {
            'NO2': 1.88,
            'O3': 1.96,
            'SO2': 2.62
        };
        
        // Add click handler for popups
        map.on('click', 'ground-stations-layer', (e) => {
            // Close existing popup if any
            if (popup) {
                popup.remove();
            }
            const feature = e.features[0];
            const props = feature.properties;
            
            // Convert ground truth value to µg/m³
            let groundTruthUgPerM3 = null;
            if (props.ground_truth_value !== undefined && !isNaN(props.ground_truth_value)) {
                if (pollutant === 'PM2.5' || pollutant === 'PM10') {
                    // Already in µg/m³
                    groundTruthUgPerM3 = props.ground_truth_value;
                } else {
                    // Convert from ppb to µg/m³
                    const conversionFactor = ppbToUgPerM3[pollutant] || 1.0;
                    groundTruthUgPerM3 = props.ground_truth_value * conversionFactor;
                }
            }
            
            // Convert predicted value to µg/m³ if available
            let predictedUgPerM3 = null;
            if (props.predicted_value !== undefined && !isNaN(props.predicted_value)) {
                // Predicted values are already in µg/m³
                predictedUgPerM3 = props.predicted_value;
            }
            
            // Build popup HTML
            let popupHTML = `<div style="font-family: 'Poppins', sans-serif; font-size: 11px; color: #000000; padding: 4px 6px; line-height: 1.4;">
                <strong>${pollutant}</strong><br>`;
            
            // Show measured (ground truth) value
            if (groundTruthUgPerM3 !== null) {
                popupHTML += `Measured: ${groundTruthUgPerM3.toFixed(2)} &micro;g/m³<br>`;
            } else {
                popupHTML += `Measured: N/A<br>`;
            }
            
            // Show predicted value if available
            if (predictedUgPerM3 !== null) {
                popupHTML += `Predicted: ${predictedUgPerM3.toFixed(2)} &micro;g/m³`;
                
                // Calculate and show error if both values available
                if (groundTruthUgPerM3 !== null) {
                    const error = predictedUgPerM3 - groundTruthUgPerM3;
                    popupHTML += `<br><span style="font-size: 10px; color: #666;">Error: ${error >= 0 ? '+' : ''}${error.toFixed(2)}</span>`;
                }
            }
            
            popupHTML += `</div>`;
            
            popup = new maplibregl.Popup({
                closeButton: false,
                closeOnClick: true,
                className: 'ground-station-popup'
            })
                .setLngLat(e.lngLat)
                .setHTML(popupHTML)
                .addTo(map);
        });
        
        // Change cursor on hover
        map.on('mouseenter', 'ground-stations-layer', () => {
            map.getCanvas().style.cursor = 'pointer';
        });
        
        map.on('mouseleave', 'ground-stations-layer', () => {
            map.getCanvas().style.cursor = '';
        });
        
    } catch (error) {
        console.error('Error loading ground stations:', error);
        // Remove stations on error
        if (map.getLayer('ground-stations-layer')) {
            map.removeLayer('ground-stations-layer');
        }
        if (map.getSource('ground-stations-source')) {
            map.removeSource('ground-stations-source');
        }
    }
}

// Load PNG Raster layer with bounds JSON (recommended method)
// This is faster and more reliable than loading GeoTIFF directly
async function loadPNGRasterLayer(pngPath, boundsPath, sourceId = 'png-raster-source', layerId = 'png-raster-layer') {
    try {
        console.log('📖 Loading PNG raster:', pngPath);
        
        // Load bounds JSON file
        const boundsResponse = await fetch(boundsPath);
        if (!boundsResponse.ok) {
            console.log(`⚠️ Bounds file not found at ${boundsPath}, skipping...`);
            return;
        }
        
        const boundsData = await boundsResponse.json();
        const geometry = boundsData.features[0].geometry;
        const coordinates = geometry.coordinates[0];
        
        // Extract corner coordinates [lng, lat]
        // Assuming coordinates are: [top-left, top-right, bottom-right, bottom-left, top-left (closing)]
        const topLeft = coordinates[0];
        const topRight = coordinates[1];
        const bottomRight = coordinates[2];
        const bottomLeft = coordinates[3];
        
        console.log('📍 Bounds coordinates:', {
            topLeft,
            topRight,
            bottomRight,
            bottomLeft,
            crs: boundsData.features[0].properties?.target_crs || 'unknown'
        });
        
        // Log the image center for debugging
        const centerLng = (topLeft[0] + bottomRight[0]) / 2;
        const centerLat = (topLeft[1] + bottomRight[1]) / 2;
        console.log(`📍 Image center: [${centerLng}, ${centerLat}]`);
        console.log(`📍 Image size: ${Math.abs(topRight[0] - topLeft[0])}° longitude x ${Math.abs(topLeft[1] - bottomLeft[1])}° latitude`);
        
        // Remove existing source/layer if present (only if using default IDs)
        if (sourceId === 'png-raster-source' && map.getSource('png-raster-source')) {
            map.removeSource('png-raster-source');
        }
        if (layerId === 'png-raster-layer' && map.getLayer('png-raster-layer')) {
            map.removeLayer('png-raster-layer');
        }
        
        console.log('📤 Adding image source with coordinates:', {
            topLeft,
            topRight,
            bottomRight,
            bottomLeft
        });
        
        // Add image source with 4 corner coordinates
        try {
            map.addSource(sourceId, {
                type: 'image',
                url: pngPath,
                coordinates: [
                    topLeft,     // top-left [lng, lat]
                    topRight,    // top-right [lng, lat]
                    bottomRight, // bottom-right [lng, lat]
                    bottomLeft   // bottom-left [lng, lat]
                ]
            });
            console.log(`✅ Image source added: ${sourceId}`);
        } catch (error) {
            console.error('❌ Error adding image source:', error);
            return;
        }
        
        // Add raster layer with RGB channels - add it ON TOP of everything
        try {
            map.addLayer({
                id: layerId,
                type: 'raster',
                source: sourceId,
                paint: {
                    'raster-opacity': 1.0, // Full opacity to see the image clearly
                    'raster-resampling': 'nearest' // Use nearest neighbor to preserve raw pixels, no interpolation/blurring
                }
            });
            console.log(`✅ PNG raster layer added to map: ${layerId}`);
            
            // Move layer to top to ensure it's visible
            if (map.getLayer('png-raster-layer')) {
                // Try to move it to the top
                const layers = map.getStyle().layers;
                const topLayer = layers[layers.length - 1].id;
                if (topLayer !== 'png-raster-layer') {
                    map.moveLayer('png-raster-layer');
                    console.log('✅ Moved layer to top');
                }
            }
        } catch (error) {
            console.error('❌ Error adding raster layer:', error);
            return;
        }
        
        console.log('📍 Image bounds:', {
            topLeft: topLeft,
            bottomRight: bottomRight,
            center: [(topLeft[0] + bottomRight[0]) / 2, (topLeft[1] + bottomRight[1]) / 2]
        });
        
        // Verify the layer was added
        if (map.getLayer('png-raster-layer')) {
            console.log('✅ Layer verified in map');
        } else {
            console.error('❌ Layer not found in map after adding!');
        }
        
    } catch (error) {
        console.error('❌ Error loading PNG raster:', error);
        console.log('PNG raster data not available:', error.message);
    }
}

// Load RGB Raster layer (PNG with bounds JSON)
// To use this:
// 1. Prepare your RGB image (PNG format) with 3 channels (Red, Green, Blue)
// 2. Create a bounds JSON file with corner coordinates
// 3. Place files in data/ folder (e.g., data/rgb_data.png and data/rgb_data_bounds.json)
// 4. Update the file paths below
async function loadRGBRaster() {
    try {
        // Load bounds JSON file - UPDATE THIS PATH
        const boundsResponse = await fetch('data/rgb_data_bounds.json');
        if (!boundsResponse.ok) {
            console.log('RGB raster data not found, skipping...');
            return;
        }
        
        const boundsData = await boundsResponse.json();
        const coordinates = boundsData.geometry.coordinates[0];
        
        // Extract corner coordinates [lng, lat]
        const topLeft = coordinates[0];
        const topRight = coordinates[1];
        const bottomRight = coordinates[2];
        const bottomLeft = coordinates[3];
        
        // Add image source with 4 corner coordinates - UPDATE THIS PATH
        map.addSource('rgb-raster', {
            type: 'image',
            url: 'data/rgb_data.png', // UPDATE: Path to your RGB image
            coordinates: [
                topLeft,     // top-left [lng, lat]
                topRight,    // top-right [lng, lat]
                bottomRight, // bottom-right [lng, lat]
                bottomLeft   // bottom-left [lng, lat]
            ]
        });
        
        // Add raster layer with RGB channels
        map.addLayer({
            id: 'rgb-raster-layer',
            type: 'raster',
            source: 'rgb-raster',
            paint: {
                'raster-opacity': 0.8, // Adjust opacity as needed
                'raster-resampling': 'linear' // Use linear resampling for better quality
            }
        }, 'satellite-layer'); // Add above satellite layer
        
        console.log('✅ RGB raster layer loaded successfully');
        
    } catch (error) {
        console.log('RGB raster data not available:', error.message);
    }
}

// GeoTIFF loading is now handled in geotiff-loader.js

// Load ALOS PALSAR raster layer (PNG with bounds JSON)
// To use this: 
// 1. Run data_processing/export_for_webmap.py to create PNG and bounds JSON
// 2. Place files in data/ folder
// 3. This function will automatically load them
async function loadALOSRaster() {
    try {
        // Load bounds JSON file
        const boundsResponse = await fetch('data/alos_palsar_kufra_basin_bounds.json');
        if (!boundsResponse.ok) {
            console.log('ALOS PALSAR data not found, skipping...');
            return;
        }
        
        const boundsData = await boundsResponse.json();
        const coordinates = boundsData.geometry.coordinates[0];
        
        // Extract corner coordinates [lng, lat]
        const topLeft = coordinates[0];
        const topRight = coordinates[1];
        const bottomRight = coordinates[2];
        const bottomLeft = coordinates[3];
        
        // Add image source with 4 corner coordinates
        map.addSource('alos-palsar', {
            type: 'image',
            url: 'data/alos_palsar_kufra_basin.png',
            coordinates: [
                topLeft,     // top-left [lng, lat]
                topRight,    // top-right [lng, lat]
                bottomRight, // bottom-right [lng, lat]
                bottomLeft   // bottom-left [lng, lat]
            ]
        });
        
        // Add raster layer
        map.addLayer({
            id: 'alos-palsar-layer',
            type: 'raster',
            source: 'alos-palsar',
            paint: {
                'raster-opacity': 0.7
            }
        }); // Add raster layer
        
        console.log('✅ ALOS PALSAR layer loaded successfully');
        
    } catch (error) {
        console.log('ALOS PALSAR data not available:', error.message);
    }
}

// Transform coordinates from Web Mercator (EPSG:3857) to WGS84 (EPSG:4326)
function transformGeoJSON(geoJson) {
    // Check if coordinates are already in WGS84 (between -180 and 180 for longitude)
    const firstCoord = geoJson.features[0].geometry.coordinates[0][0][0];
    
    // If coordinates are in Web Mercator (large numbers), transform them
    if (Math.abs(firstCoord[0]) > 180 || Math.abs(firstCoord[1]) > 90) {
        return transformCoordinates(geoJson);
    }
    
    return geoJson;
}

// Transform Web Mercator to WGS84
function transformCoordinates(geoJson) {
    const transformed = JSON.parse(JSON.stringify(geoJson));
    
    function transformPoint(coord) {
        const x = coord[0];
        const y = coord[1];
        const lng = (x / 20037508.34) * 180;
        let lat = (y / 20037508.34) * 180;
        lat = (Math.atan(Math.exp((lat * Math.PI) / 180)) * 360) / Math.PI - 90;
        return [lng, lat];
    }
    
    function transformCoordinatesRecursive(coords) {
        if (typeof coords[0] === 'number') {
            return transformPoint(coords);
        }
        return coords.map(transformCoordinatesRecursive);
    }
    
    transformed.features.forEach(feature => {
        if (feature.geometry.type === 'MultiPolygon') {
            feature.geometry.coordinates = feature.geometry.coordinates.map(polygon =>
                polygon.map(ring => ring.map(transformCoordinatesRecursive))
            );
        } else if (feature.geometry.type === 'Polygon') {
            feature.geometry.coordinates = feature.geometry.coordinates.map(ring =>
                ring.map(transformCoordinatesRecursive)
            );
        }
    });
    
    return transformed;
}

// Fit map bounds to show the Sahara desert
function fitSaharaBounds(geoJson) {
    const bounds = new maplibregl.LngLatBounds();
    
    geoJson.features.forEach(feature => {
        if (feature.geometry.type === 'MultiPolygon') {
            feature.geometry.coordinates.forEach(polygon => {
                polygon.forEach(ring => {
                    ring.forEach(coord => {
                        bounds.extend(coord);
                    });
                });
            });
        } else if (feature.geometry.type === 'Polygon') {
            feature.geometry.coordinates.forEach(ring => {
                ring.forEach(coord => {
                    bounds.extend(coord);
                });
            });
        }
    });
    
    map.fitBounds(bounds, {
        padding: { top: 50, bottom: 50, left: 360, right: 50 }, // Extra left padding for widgets
        duration: 2000,
        maxZoom: 5
    });
}

// Point in polygon check
function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i][0], yi = polygon[i][1];
        const xj = polygon[j][0], yj = polygon[j][1];
        const intersect = ((yi > point[1]) !== (yj > point[1])) &&
            (point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// Check if point is inside any Sahara polygon
function isPointInSahara(lng, lat, saharaGeoJSON) {
    const point = [lng, lat];
    
    for (const feature of saharaGeoJSON.features) {
        if (feature.geometry.type === 'MultiPolygon') {
            for (const polygon of feature.geometry.coordinates) {
                // Check outer ring (first ring)
                if (polygon.length > 0 && pointInPolygon(point, polygon[0])) {
                    return true;
                }
            }
        } else if (feature.geometry.type === 'Polygon') {
            // Check outer ring (first ring)
            if (feature.geometry.coordinates.length > 0 && 
                pointInPolygon(point, feature.geometry.coordinates[0])) {
                return true;
            }
        }
    }
    return false;
}

// Setup event handlers
function setupEventHandlers() {
    // Click handler for entire map - check if clicking inside Sahara
    map.on('click', (e) => {
        const source = map.getSource('sahara-source');
        if (source && source._data) {
            const isInside = isPointInSahara(e.lngLat.lng, e.lngLat.lat, source._data);
            
            // No action on click - widget removed
        }
    });
    
    
    // References button removed
    
    // Close popup handlers
    const popup = document.getElementById('image-popup');
    const popupClose = popup.querySelector('.popup-close');
    const popupOverlay = popup.querySelector('.popup-overlay');
    
    popupClose.addEventListener('click', () => {
        hideImagePopup();
    });
    
    popupOverlay.addEventListener('click', () => {
        hideImagePopup();
    });
    
    // Close popup on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !popup.classList.contains('hidden')) {
            hideImagePopup();
        }
    });
    
}

// Mobile Toggle Functionality - Opens Info Popup
function initMobileToggle() {
    const toggleBtn = document.getElementById('mobile-toggle');
    const infoPopup = document.getElementById('info-popup');
    const popupClose = document.querySelector('.info-popup-close');
    const popupOverlay = document.querySelector('.info-popup-overlay');
    
    if (!toggleBtn || !infoPopup) return; // Only run if elements exist
    
    // Open popup when button is clicked
    toggleBtn.addEventListener('click', () => {
        showInfoPopup();
    });
    
    // Close popup handlers
    if (popupClose) {
        popupClose.addEventListener('click', () => {
            hideInfoPopup();
        });
    }
    
    if (popupOverlay) {
        popupOverlay.addEventListener('click', () => {
            hideInfoPopup();
        });
    }
    
    // Close popup on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !infoPopup.classList.contains('hidden')) {
            hideInfoPopup();
        }
    });
}

// Mobile Tab Switcher Functionality
function initMobileTabSwitcher() {
    const tabSwitcher = document.querySelector('.mobile-tab-switcher');
    const infoPanel = document.getElementById('mobile-info-panel');
    if (!tabSwitcher) return; // Only run if element exists
    
    const tabs = document.querySelectorAll('.mobile-tab');
    const indicator = document.querySelector('.mobile-tab-indicator');
    const monthSelector = document.querySelector('.mobile-month-selector');
    const colorbar = document.getElementById('mobile-colorbar');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const tabName = tab.getAttribute('data-tab');
            
            // Update active state
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Move indicator
            if (indicator) {
                const tabIndex = Array.from(tabs).indexOf(tab);
                indicator.style.transform = `translateX(${tabIndex * 100}%)`;
            }
            
            // Toggle info panel and month selector
            if (tabName === 'info') {
                // Show info panel, hide month selector
                if (infoPanel) {
                    infoPanel.classList.add('visible');
                }
                if (monthSelector) {
                    monthSelector.style.display = 'none';
                }
                if (colorbar) {
                    colorbar.style.display = 'none';
                }
                tabSwitcher.classList.add('info-active');
            } else {
                // Hide info panel, show month selector
                if (infoPanel) {
                    infoPanel.classList.remove('visible');
                }
                if (monthSelector) {
                    monthSelector.style.display = 'block';
                }
                if (colorbar) {
                    colorbar.style.display = 'flex';
                }
                tabSwitcher.classList.remove('info-active');
            }
        });
    });
}

// Desktop Tab Switcher Functionality (Folder-like tabs)
function initDesktopTabSwitcher() {
    const widget = document.querySelector('.explanation-widget');
    const tabs = document.querySelectorAll('.desktop-folder-tab');
    const infoPanel = document.getElementById('desktop-info-panel');
    const controlsPanel = document.getElementById('desktop-controls-panel');
    const collapseBtn = document.getElementById('explanation-collapse');
    
    if (!widget || !tabs.length) return;
    
    tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const tabName = tab.getAttribute('data-tab');
            const slideIndex = tab.getAttribute('data-slide');
            
            // If widget is collapsed, expand it
            if (widget.classList.contains('collapsed')) {
                widget.classList.remove('collapsed');
                if (collapseBtn) {
                    collapseBtn.textContent = '‹';
                }
            }
            
            // Update active state
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Toggle panels and navigate to slide if it's an info tab
            if (tabName === 'info' && slideIndex !== null) {
                if (infoPanel) {
                    infoPanel.classList.add('active');
                }
                if (controlsPanel) {
                    controlsPanel.classList.remove('active');
                }
                widget.classList.remove('controls-active');
                
                // Navigate to the specific slide
                const slideIdx = parseInt(slideIndex, 10);
                
                if (window.innerWidth >= 769) {
                    // Desktop: use goToSlide function
                    if (window.goToSlideDesktop) {
                        window.goToSlideDesktop(slideIdx);
                    }
                } else {
                    // Mobile: use indicators
                    const indicators = document.querySelectorAll('.indicator');
                    if (indicators && indicators[slideIdx]) {
                        indicators[slideIdx].click();
                    }
                }
            } else if (tabName === 'controls') {
                if (infoPanel) {
                    infoPanel.classList.remove('active');
                }
                if (controlsPanel) {
                    controlsPanel.classList.add('active');
                }
                widget.classList.add('controls-active');
            }
        });
    });
    
    // Update active tab when carousel slide changes
    const indicators = document.querySelectorAll('.indicator');
    indicators.forEach((indicator, index) => {
        indicator.addEventListener('click', () => {
            // Find the corresponding tab and make it active
            const infoTabs = document.querySelectorAll('.desktop-folder-tab[data-tab="info"]');
            if (infoTabs[index]) {
                tabs.forEach(t => t.classList.remove('active'));
                infoTabs[index].classList.add('active');
            }
        });
    });
}

// Location selection functionality
function initDesktopLocationSelector() {
    const locationButtons = document.querySelectorAll('.desktop-location-btn');
    
    if (!locationButtons.length || !map) return;
    
    // Map location IDs to city names
    const cityMap = {
        'frascati': 'Frascati',
        'bologna': 'Bologna',
        'milano': 'Milano',
        'salt-lake-city': null, // Legacy - no city-specific folder
        'los-angeles': null,
        'cook': null,
        'harris': null,
        'maricopa': null,
        'san-diego': null
    };
    
    locationButtons.forEach(button => {
        button.addEventListener('click', () => {
            const location = button.getAttribute('data-location');
            const centerStr = button.getAttribute('data-center');
            const zoomStr = button.getAttribute('data-zoom');
            
            if (!centerStr || !zoomStr) return;
            
            // Parse center coordinates
            const center = JSON.parse(centerStr);
            const zoom = parseFloat(zoomStr);
            
            // Update current city and reload layers if changed
            const newCity = cityMap[location] || null;
            if (newCity !== currentCity) {
                currentCity = newCity;
                // Update year dropdowns to show available years for new city
                updateAllYearDropdowns();
                // Force reload of prediction layers for new city
                loadedPollutant = null;
                loadedYear = null;
                loadPredictedLayer(currentCompositeYear, currentCompositeMonth, currentPollutant);
            }
            
            // Update active button
            locationButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            
            // Transition map to new location
            transitionMapToLocation(center, zoom);
        });
    });
}

// Transition map with zoom out effect
function transitionMapToLocation(center, zoom) {
    if (!map) return;
    
    const currentZoom = map.getZoom();
    const targetZoom = zoom;
    
    // First, zoom out to a lower zoom level
    const intermediateZoom = Math.min(currentZoom, targetZoom) - 2;
    const finalZoom = targetZoom;
    
    // Animate: zoom out, then pan and zoom in
    map.easeTo({
        center: center,
        zoom: intermediateZoom,
        duration: 800,
        easing: (t) => {
            // Ease out function for smooth transition
            return 1 - Math.pow(1 - t, 3);
        }
    });
    
    // After zooming out, transition to final position
    setTimeout(() => {
        map.easeTo({
            center: center,
            zoom: finalZoom,
            duration: 1000,
            easing: (t) => {
                // Ease in-out function
                return t < 0.5 
                    ? 2 * t * t 
                    : 1 - Math.pow(-2 * t + 2, 2) / 2;
            }
        });
    }, 400);
}

// Mobile Info Carousel functionality
function initMobileInfoCarousel() {
    const infoPanel = document.getElementById('mobile-info-panel');
    if (!infoPanel) return;
    
    const content = infoPanel.querySelector('.mobile-info-panel-content');
    const container = infoPanel.querySelector('.mobile-info-carousel-container');
    const indicators = infoPanel.querySelectorAll('.mobile-info-indicator');
    const slides = infoPanel.querySelectorAll('.mobile-info-slide');
    
    if (!content || !container || !indicators.length || !slides.length) return;
    
    let currentSlide = 0;
    const totalSlides = slides.length;
    let touchStartX = 0;
    let touchStartY = 0;
    let touchEndX = 0;
    let touchEndY = 0;
    let isDragging = false;
    let isHorizontalSwipe = null;
    
    // Touch events on the entire content area for better swipe detection
    // Only handle horizontal swipes, allow vertical scrolling
    content.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchEndX = touchStartX;
        touchEndY = touchStartY;
        isDragging = true;
        isHorizontalSwipe = null;
    }, { passive: true });
    
    content.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        
        touchEndX = e.touches[0].clientX;
        touchEndY = e.touches[0].clientY;
        
        // Determine if this is a horizontal or vertical swipe
        if (isHorizontalSwipe === null) {
            const diffX = Math.abs(touchEndX - touchStartX);
            const diffY = Math.abs(touchEndY - touchStartY);
            if (diffX > 10 || diffY > 10) {
                isHorizontalSwipe = diffX > diffY;
                // If it's a horizontal swipe, prevent default to stop page scrolling
                if (isHorizontalSwipe) {
                    e.preventDefault();
                }
            }
        } else if (isHorizontalSwipe) {
            // If we've determined it's horizontal, prevent default scrolling
            e.preventDefault();
        }
    }, { passive: false });
    
    content.addEventListener('touchend', (e) => {
        if (isDragging && isHorizontalSwipe) {
            handleSwipe();
        }
        isDragging = false;
        isHorizontalSwipe = null;
    });
    
    // Indicator click events
    indicators.forEach((indicator, index) => {
        indicator.addEventListener('click', () => {
            goToSlide(index);
        });
    });
    
    function handleSwipe() {
        const swipeThreshold = 40;
        const diff = touchStartX - touchEndX;
        
        if (Math.abs(diff) > swipeThreshold) {
            if (diff > 0) {
                // Swipe left - next slide
                nextSlide('left');
            } else {
                // Swipe right - previous slide
                prevSlide('right');
            }
        }
    }
    
    function goToSlide(index, direction = null) {
        if (index < 0 || index >= totalSlides) return;
        
        const oldSlide = currentSlide;
        currentSlide = index;
        updateCarousel(direction || (index > oldSlide ? 'left' : 'right'));
    }
    
    function nextSlide(direction = 'left') {
        currentSlide = (currentSlide + 1) % totalSlides;
        updateCarousel(direction);
    }
    
    function prevSlide(direction = 'right') {
        currentSlide = (currentSlide - 1 + totalSlides) % totalSlides;
        updateCarousel(direction);
    }
    
    function updateCarousel(direction = null) {
        // Update slides with animation
        slides.forEach((slide, index) => {
            slide.classList.remove('active', 'slide-left', 'slide-right');
            
            if (index === currentSlide) {
                slide.classList.add('active');
                if (direction) {
                    slide.classList.add(direction === 'left' ? 'slide-from-right' : 'slide-from-left');
                    // Remove animation class after animation completes
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            slide.classList.remove('slide-from-right', 'slide-from-left');
                        });
                    });
                }
            }
        });
        
        // Update indicators
        indicators.forEach((indicator, index) => {
            if (index === currentSlide) {
                indicator.classList.add('active');
            } else {
                indicator.classList.remove('active');
            }
        });
    }
    
    // Initialize
    updateCarousel();
}

function showInfoPopup() {
    const infoPopup = document.getElementById('info-popup');
    if (infoPopup) {
        infoPopup.classList.remove('hidden');
        // Prevent body scroll when popup is open
        document.body.style.overflow = 'hidden';
    }
}

function hideInfoPopup() {
    const infoPopup = document.getElementById('info-popup');
    if (infoPopup) {
        infoPopup.classList.add('hidden');
        // Restore body scroll
        document.body.style.overflow = '';
    }
}

// Show image popup
function showImagePopup() {
    const popup = document.getElementById('image-popup');
    popup.classList.remove('hidden');
}

// Hide image popup
function hideImagePopup() {
    const popup = document.getElementById('image-popup');
    popup.classList.add('hidden');
}

// Display feature information in floating widget
function displayFeatureInfo(feature) {
    const infoDiv = document.getElementById('feature-info');
    const contentDiv = document.getElementById('feature-content');
    
    const props = feature.properties;
    let html = '';
    
    if (props.NAME) {
        html += `<p><strong>Name:</strong> ${props.NAME}</p>`;
    }
    if (props.NAME_EN) {
        html += `<p><strong>English Name:</strong> ${props.NAME_EN}</p>`;
    }
    if (props.REGION) {
        html += `<p><strong>Region:</strong> ${props.REGION}</p>`;
    }
    if (props.LABEL) {
        html += `<p><strong>Label:</strong> ${props.LABEL}</p>`;
    }
    if (props.FEATURECLA) {
        html += `<p><strong>Feature Class:</strong> ${props.FEATURECLA}</p>`;
    }
    
    contentDiv.innerHTML = html;
    infoDiv.classList.remove('hidden');
}

// Hide feature information
function hideFeatureInfo() {
    document.getElementById('feature-info').classList.add('hidden');
}

// SVG icons for base map switcher
// Better satellite icon - satellite dish
const satelliteIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2L4 8L12 14L20 8L12 2Z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>
    <path d="M4 8L12 14L20 8" stroke="currentColor" stroke-width="1.5" fill="none"/>
    <path d="M12 14L12 22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <circle cx="12" cy="8" r="2" fill="currentColor"/>
    <path d="M8 6L16 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M8 10L16 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

// Better OSM icon - map with grid/roads
const osmIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="3" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" rx="1"/>
    <path d="M3 9H21M3 15H21M9 3V21M15 3V21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    <circle cx="9" cy="9" r="1.5" fill="currentColor"/>
    <circle cx="15" cy="9" r="1.5" fill="currentColor"/>
    <circle cx="9" cy="15" r="1.5" fill="currentColor"/>
    <circle cx="15" cy="15" r="1.5" fill="currentColor"/>
</svg>`;

// Custom base map switcher control
function addBaseMapSwitcher() {
    const BaseMapSwitcher = function(options) {
        this.currentMap = 'satellite'; // Default to satellite
    };
    
    BaseMapSwitcher.prototype.onAdd = function(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group base-map-switcher';
        
        const button = document.createElement('button');
        button.className = 'base-map-btn';
        
        // Create image element for the icon
        const icon = document.createElement('img');
        icon.src = 'images/osm_map.png';
        icon.style.width = '20px';
        icon.style.height = '20px';
        icon.style.display = 'block';
        icon.className = 'base-map-icon osm-icon'; // Add class to identify OSM icon
        button.appendChild(icon);
        
        button.setAttribute('aria-label', 'Switch base map');
        button.setAttribute('title', 'Switch base map');
        
        button.addEventListener('click', () => {
            if (this.currentMap === 'satellite') {
                this.currentMap = 'osm';
                icon.src = 'images/satellite.png';
                icon.className = 'base-map-icon satellite-icon'; // Update class for satellite
                switchBaseMap('osm');
            } else {
                this.currentMap = 'satellite';
                icon.src = 'images/osm_map.png';
                icon.className = 'base-map-icon osm-icon'; // Update class for OSM
                switchBaseMap('satellite');
            }
        });
        
        this._button = button; // Store reference
        this._container.appendChild(button);
        return this._container;
    };
    
    BaseMapSwitcher.prototype.onRemove = function() {
        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
    };
    
    map.addControl(new BaseMapSwitcher(), 'top-right');
    
    // Add desktop color bar as a sidebar
    map.on('load', () => {
        const mapContainer = document.getElementById('map-view');
        if (!mapContainer) return;
        
        // Create color bar container
        const colorbarContainer = document.createElement('div');
        colorbarContainer.className = 'desktop-colorbar-container';
        colorbarContainer.id = 'desktop-colorbar';
        
        // Unit label at top
        const unitLabel = document.createElement('div');
        unitLabel.className = 'desktop-colorbar-unit';
        unitLabel.textContent = 'µg/m³';
        colorbarContainer.appendChild(unitLabel);
        
        // Max value at top
        const maxValue = document.createElement('div');
        maxValue.className = 'desktop-colorbar-value desktop-colorbar-max';
        maxValue.id = 'desktop-colorbar-max';
        maxValue.textContent = '80';
        colorbarContainer.appendChild(maxValue);
        
        // Vertical gradient
        const gradient = document.createElement('div');
        gradient.className = 'desktop-colorbar-gradient';
        colorbarContainer.appendChild(gradient);
        
        // Min value at bottom
        const minValue = document.createElement('div');
        minValue.className = 'desktop-colorbar-value desktop-colorbar-min';
        minValue.id = 'desktop-colorbar-min';
        minValue.textContent = '20';
        colorbarContainer.appendChild(minValue);
        
        // Append to map container
        mapContainer.appendChild(colorbarContainer);
        
        // Position color bar: directly below compass control, matching controls width and alignment
        // Also position time selector widget and explanation widget with same offset
        const updateColorBarPosition = () => {
            const compassControl = mapContainer.querySelector('.maplibregl-ctrl-compass');
            const zoomControls = mapContainer.querySelector('.maplibregl-ctrl-zoom-in');
            const baseMapBtn = mapContainer.querySelector('.base-map-btn');
            const timeSelector = document.querySelector('.time-selector-widget');
            const explanationWidget = document.querySelector('.explanation-widget');
            
            if (compassControl && zoomControls) {
                const compassRect = compassControl.getBoundingClientRect();
                const zoomRect = zoomControls.getBoundingClientRect();
                const mapRect = mapContainer.getBoundingClientRect();
                
                // Position directly below compass control (add small spacing)
                const topPosition = compassRect.bottom - mapRect.top + 10;
                
                // Match the width of the zoom controls (plus/minus buttons)
                const controlWidth = zoomRect.width;
                
                // Align horizontal position with controls (same distance from right edge)
                const rightPosition = mapRect.right - compassRect.right;
                
                // Calculate bottom position if time selector exists
                let bottomStyle = '';
                if (timeSelector) {
                    const timeRect = timeSelector.getBoundingClientRect();
                    const bottomPosition = mapRect.bottom - timeRect.top + 10;
                    bottomStyle = `${bottomPosition}px`;
                }
                
                colorbarContainer.style.top = `${topPosition}px`;
                if (bottomStyle) {
                    colorbarContainer.style.bottom = bottomStyle;
                }
                colorbarContainer.style.right = `${rightPosition}px`;
                colorbarContainer.style.left = 'auto';
                colorbarContainer.style.width = `${controlWidth}px`;
                
                // Position time selector widget with same offset on both left and right sides
                if (timeSelector) {
                    timeSelector.style.left = `${rightPosition}px`;
                    timeSelector.style.right = `${rightPosition}px`;
                }
                
                // Position explanation widget with same offset from left as colorbar from right
                // Top position matches base map button, bottom matches colorbar (same distance to slider)
                if (explanationWidget) {
                    explanationWidget.style.left = `${rightPosition}px`;
                    
                    // Match top position with base map button
                    if (baseMapBtn) {
                        const baseMapRect = baseMapBtn.getBoundingClientRect();
                        const explanationTopPosition = baseMapRect.top - mapRect.top;
                        explanationWidget.style.top = `${explanationTopPosition}px`;
                    }
                    
                    // Match bottom position with colorbar (same distance to slider)
                    if (bottomStyle) {
                        explanationWidget.style.bottom = bottomStyle;
                        // Remove height constraint when bottom is set to allow proper sizing
                        explanationWidget.style.height = 'auto';
                    }
                }
            }
        };
        
        // Update position on load and resize
        updateColorBarPosition();
        window.addEventListener('resize', updateColorBarPosition);
        
        // Also update when controls might change
        setTimeout(updateColorBarPosition, 100);
    });
}

// Switch base map layer
function switchBaseMap(layerType) {
    const isSatellite = layerType === 'satellite';
    const baseLayerId = isSatellite ? 'satellite-layer' : 'osm-tiles-layer';
    
    // Remove existing base layer
    if (map.getLayer('osm-tiles-layer')) {
        map.removeLayer('osm-tiles-layer');
    }
    if (map.getLayer('satellite-layer')) {
        map.removeLayer('satellite-layer');
    }
    
    // Find the predicted layer to add base layer before it (so predictions stay on top)
    let beforeId = null;
    
    // Check for current predicted layer
    if (map.getLayer('predicted-layer-current')) {
        beforeId = 'predicted-layer-current';
    } else {
        // Fallback: check for month-based predicted layers
        for (let m = 1; m <= 12; m++) {
            const monthStr = String(m).padStart(2, '0');
            const layerId = `predicted-layer-${monthStr}`;
            if (map.getLayer(layerId)) {
                beforeId = layerId;
                break;
            }
        }
    }
    
    // Also check for ground stations layer (should be above base map)
    if (!beforeId && map.getLayer('ground-stations-layer')) {
        beforeId = 'ground-stations-layer';
    }
    if (!beforeId && map.getLayer('all-stations-layer')) {
        beforeId = 'all-stations-layer';
    }
    
    // Add new base layer - before predicted layers if they exist, otherwise at bottom
    const layerConfig = {
        id: baseLayerId,
        type: 'raster',
        source: isSatellite ? 'satellite-tiles' : 'osm-tiles',
        minzoom: 0,
        maxzoom: 19
    };
    
    if (beforeId) {
        // Add before the predicted layer so predictions stay visible on top
        map.addLayer(layerConfig, beforeId);
    } else {
        // No predicted layers, add at bottom
        map.addLayer(layerConfig);
    }
}

// Explanation Carousel functionality
let currentSlide = 0;
let totalSlides = 5; // Introduction, Data Collection, Model, Results, Authors
let touchStartX = 0;
let touchEndX = 0;
let isDragging = false;

function initExplanationCarousel() {
    const carousel = document.querySelector('.explanation-carousel');
    const container = document.querySelector('.carousel-container');
    const indicators = document.querySelectorAll('.indicator');
    const slides = document.querySelectorAll('.carousel-slide');
    
    // Update totalSlides based on actual number of slides
    totalSlides = slides.length;
    
    // Check if desktop or mobile
    const isDesktop = window.innerWidth >= 769;
    
    if (isDesktop) {
        // Desktop: Manual navigation with arrows only
        // Show slide based on currentSlide index
        function showSlide(index) {
            slides.forEach((slide, i) => {
                if (i === index) {
                    slide.classList.add('active');
                    // Reset scroll to top when switching slides
                    slide.scrollTop = 0;
                    // Add scroll listener to this slide
                    setupSlideScrollListener(slide);
                } else {
                    slide.classList.remove('active');
                }
            });
        }
        
        // Check if user has scrolled to bottom of current slide
        function checkScrollPosition(slide) {
            if (!slide) return;
            
            const scrollTop = slide.scrollTop;
            const scrollHeight = slide.scrollHeight;
            const clientHeight = slide.clientHeight;
            
            // Show arrow only when very close to bottom (10px threshold)
            const showThreshold = 10;
            // Hide arrow sooner when scrolling up (50px from bottom)
            const hideThreshold = 50;
            
            const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
            
            // Find arrow in this slide
            const arrow = slide.querySelector('.carousel-nav-arrows');
            if (arrow && currentSlide < totalSlides - 1) {
                // Show only when very close to bottom, hide when more than 50px away
                if (distanceFromBottom <= showThreshold) {
                    arrow.classList.add('visible');
                } else if (distanceFromBottom > hideThreshold) {
                    arrow.classList.remove('visible');
                }
            } else if (arrow) {
                // Hide arrow if on last slide
                arrow.classList.remove('visible');
            }
        }
        
        // Make checkScrollPosition available globally
        window.checkScrollPosition = checkScrollPosition;
        
        // Setup scroll listener for active slide
        function setupSlideScrollListener(slide) {
            if (!slide) return;
            
            // Remove previous listeners
            const oldSlide = document.querySelector('.carousel-slide.active');
            if (oldSlide && oldSlide !== slide) {
                oldSlide.removeEventListener('scroll', oldSlide._scrollHandler);
            }
            
            // Add new listener
            slide._scrollHandler = () => checkScrollPosition(slide);
            slide.addEventListener('scroll', slide._scrollHandler, { passive: true });
            
            // Initial check
            checkScrollPosition(slide);
        }
        
        // Navigate to specific slide
        function goToSlide(index) {
            if (index < 0 || index >= totalSlides) return;
            
            currentSlide = index;
            showSlide(index);
            updateCarousel();
            updateArrows();
        }
        
        // Override goToSlide for desktop
        window.goToSlideDesktop = goToSlide;
        
        // Initial setup
        showSlide(currentSlide);
        updateCarousel();
        updateArrows();
        
    } else {
        // Mobile: Horizontal swipe carousel
        // Touch events for mobile - allow swiping between slides
        container.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
            isDragging = true;
        }, { passive: true });
        
        container.addEventListener('touchmove', (e) => {
            if (isDragging) {
                touchEndX = e.touches[0].clientX;
            }
        }, { passive: true });
        
        container.addEventListener('touchend', (e) => {
            if (isDragging) {
                handleSwipe();
                isDragging = false;
            }
        });
        
        // Mouse events for mobile - allow dragging between slides
        let mouseStartX = 0;
        let mouseEndX = 0;
        
        container.addEventListener('mousedown', (e) => {
            mouseStartX = e.clientX;
            isDragging = true;
            container.style.cursor = 'grabbing';
            e.preventDefault(); // Prevent text selection
        });
        
        container.addEventListener('mousemove', (e) => {
            if (isDragging) {
                mouseEndX = e.clientX;
            }
        });
        
        container.addEventListener('mouseup', (e) => {
            if (isDragging) {
                touchStartX = mouseStartX;
                touchEndX = mouseEndX;
                handleSwipe();
                isDragging = false;
                container.style.cursor = 'grab';
            }
        });
        
        container.addEventListener('mouseleave', () => {
            if (isDragging) {
                isDragging = false;
                container.style.cursor = 'grab';
            }
        });
        
        container.style.cursor = 'grab';
        
        function handleSwipe() {
            const swipeThreshold = 50;
            const diff = touchStartX - touchEndX;
            
            if (Math.abs(diff) > swipeThreshold) {
                if (diff > 0) {
                    // Swipe left - next slide
                    nextSlide();
                } else {
                    // Swipe right - previous slide
                    prevSlide();
                }
            }
        }
        
        function nextSlide() {
            currentSlide = (currentSlide + 1) % totalSlides;
            updateCarousel();
        }
        
        function prevSlide() {
            currentSlide = (currentSlide - 1 + totalSlides) % totalSlides;
            updateCarousel();
        }
        
        // Indicator click events (mobile only)
        indicators.forEach((indicator, index) => {
            indicator.addEventListener('click', () => {
                goToSlide(index);
            });
        });
    }
    
    // Navigation arrow update function (available throughout scope)
    function updateArrows() {
        // Arrow visibility is handled by updateArrowVisibility
        if (typeof updateArrowVisibility === 'function') {
            updateArrowVisibility();
        }
        // Also check scroll position if function exists
        if (window.checkScrollPosition) {
            const activeSlide = document.querySelector('.carousel-slide.active');
            if (activeSlide) {
                window.checkScrollPosition(activeSlide);
            }
        }
    }
    
    function goToSlide(index) {
        if (index < 0 || index >= totalSlides) return;
        
        if (isDesktop) {
            // Desktop: handled by goToSlide in desktop branch
            if (window.goToSlideDesktop) {
                window.goToSlideDesktop(index);
            }
        } else {
            // Mobile: switch slide
            currentSlide = index;
            updateCarousel();
        }
    }
    
    function updateCarousel() {
        // Update slides (only for mobile)
        if (!isDesktop) {
            slides.forEach((slide, index) => {
                if (index === currentSlide) {
                    slide.classList.add('active');
                } else {
                    slide.classList.remove('active');
                }
            });
        }
        
        // Update indicators (mobile only)
        if (!isDesktop) {
            indicators.forEach((indicator, index) => {
                if (index === currentSlide) {
                    indicator.classList.add('active');
                } else {
                    indicator.classList.remove('active');
                }
            });
        }
        
        // Update active folder tab to match current slide
        const infoTabs = document.querySelectorAll('.desktop-folder-tab[data-tab="info"]');
        const allTabs = document.querySelectorAll('.desktop-folder-tab');
        if (infoTabs[currentSlide]) {
            allTabs.forEach(t => t.classList.remove('active'));
            infoTabs[currentSlide].classList.add('active');
        }
    }
    
    // Initialize
    updateCarousel();
    
    // Handle window resize
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            // Reinitialize if switching between desktop/mobile
            if ((window.innerWidth >= 769) !== isDesktop) {
                location.reload(); // Simple solution - could be optimized
            }
        }, 250);
    });
}

// Initialize map when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initMap();
        initMobileToggle();
        loadAuthorsContent();
        loadSlideHTML();
        loadReferencesContent();
        initExplanationCollapse();
    });
} else {
    initMap();
    initMobileToggle();
    loadAuthorsContent();
    loadSlideHTML();
    loadReferencesContent();
    initExplanationCollapse();
}

