# Fix indentation issues in png_converter_for_webmap.py

content = open('processing/png_converter_for_webmap.py', 'r', encoding='utf-8').read()

# Fix 1: else after ita_comuni.geojson
content = content.replace(
    "'ita_comuni.geojson'\n        else:\n        boundary_filename",
    "'ita_comuni.geojson'\n    else:\n        boundary_filename"
)

# Write back
open('processing/png_converter_for_webmap.py', 'w', encoding='utf-8').write(content)
print('Fixed indentation!')

