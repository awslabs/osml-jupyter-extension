#!/usr/bin/env python3
"""
Generate small test TIFF files and GeoJSON data for integration testing
"""

import numpy as np
import json
import os
from pathlib import Path

try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False
    print("Warning: PIL/Pillow not available. Install with: pip install pillow")


def generate_test_tiffs():
    """Generate small test TIFF files"""
    fixtures_dir = Path("tests/python/fixtures")
    fixtures_dir.mkdir(parents=True, exist_ok=True)
    
    if not PIL_AVAILABLE:
        print("Skipping TIFF generation - PIL/Pillow not available")
        return
    
    # Generate 512x512 single-band TIFF with some structure
    print("Generating 512x512 single-band TIFF...")
    single_band = np.zeros((512, 512), dtype=np.uint8)
    
    # Create some structured pattern for testing
    for i in range(512):
        for j in range(512):
            # Create concentric circles pattern
            distance = np.sqrt((i - 256)**2 + (j - 256)**2)
            single_band[i, j] = min(255, int(distance / 2) % 256)
    
    single_band_img = Image.fromarray(single_band, mode='L')
    single_band_path = fixtures_dir / "sample_1band_512x512.tiff"
    single_band_img.save(single_band_path)
    print(f"Created: {single_band_path}")
    
    # Generate 256x256 RGB TIFF with gradients
    print("Generating 256x256 RGB TIFF...")
    rgb_data = np.zeros((256, 256, 3), dtype=np.uint8)
    
    for i in range(256):
        for j in range(256):
            # Create gradient patterns
            rgb_data[i, j, 0] = i  # Red gradient
            rgb_data[i, j, 1] = j  # Green gradient
            rgb_data[i, j, 2] = (i + j) // 2  # Blue combination
    
    rgb_img = Image.fromarray(rgb_data, mode='RGB')
    rgb_path = fixtures_dir / "sample_3band_256x256.tiff"
    rgb_img.save(rgb_path)
    print(f"Created: {rgb_path}")


def generate_test_geojson():
    """Generate test GeoJSON overlay data"""
    fixtures_dir = Path("tests/python/fixtures")
    fixtures_dir.mkdir(parents=True, exist_ok=True)
    
    # Create sample GeoJSON with various feature types
    geojson_data = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "name": "Test Point",
                    "type": "landmark",
                    "confidence": 0.95
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [-122.4194, 37.7749]
                }
            },
            {
                "type": "Feature",
                "properties": {
                    "name": "Test Polygon",
                    "type": "building",
                    "area": 1500.0
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [-122.42, 37.77],
                        [-122.41, 37.77],
                        [-122.41, 37.78],
                        [-122.42, 37.78],
                        [-122.42, 37.77]
                    ]]
                }
            },
            {
                "type": "Feature",
                "properties": {
                    "name": "Test LineString",
                    "type": "road",
                    "length": 500.0
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [
                        [-122.425, 37.775],
                        [-122.420, 37.776],
                        [-122.415, 37.777]
                    ]
                }
            }
        ]
    }
    
    geojson_path = fixtures_dir / "sample_overlay.geojson"
    with open(geojson_path, 'w') as f:
        json.dump(geojson_data, f, indent=2)
    print(f"Created: {geojson_path}")


def main():
    """Generate all test data"""
    print("Generating test data for OSML Jupyter Extension...")
    
    generate_test_tiffs()
    generate_test_geojson()
    
    print("\nTest data generation complete!")
    print("\nGenerated files:")
    fixtures_dir = Path("tests/python/fixtures")
    for file_path in fixtures_dir.glob("*"):
        if file_path.is_file() and not file_path.name.startswith('__'):
            size_bytes = file_path.stat().st_size
            print(f"  {file_path.name}: {size_bytes:,} bytes")


if __name__ == "__main__":
    main()
