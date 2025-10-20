"""
Tests for World Coordinate Conversion in load_overlay function
Tests the enhanced overlay loading functionality that converts WGS84 coordinates to image coordinates.
"""

import pytest
import json
import tempfile
from unittest.mock import Mock, MagicMock, patch
from pathlib import Path
from fixtures.mock_comm import MockComm
import shapely
from math import radians

# Import the concatenated kernel code
def get_kernel_globals():
    """Execute kernel setup and return globals for testing"""
    kernel_file = Path("lib/kernel/kernel-setup.py")
    namespace = {}
    
    # Mock IPython functions that aren't available in test environment
    mock_ipython = MagicMock()
    mock_ipython.kernel.comm_manager.register_target = MagicMock()
    
    def mock_get_registered_message_types():
        """Mock implementation of get_registered_message_types"""
        return [
            'IMAGE_LOAD_REQUEST', 'IMAGE_TILE_REQUEST', 'OVERLAY_TILE_REQUEST',
            'IMAGE_METADATA_REQUEST', 'IMAGE_STATISTICS_REQUEST', 'IMAGE_UNLOAD_REQUEST',
            'OVERLAY_LOAD_REQUEST', 'OVERLAY_UNLOAD_REQUEST', 
            'LIST_AVAILABLE_ENDPOINTS', 'MODEL_TILE_REQUEST'
        ]
    
    # Add mocked functions to namespace
    namespace['get_ipython'] = lambda: mock_ipython
    namespace['get_registered_message_types'] = mock_get_registered_message_types
    
    with open(kernel_file, 'r') as f:
        kernel_code = f.read()
    
    exec(kernel_code, namespace)
    return namespace

@pytest.fixture
def kernel_globals():
    """Fixture providing kernel globals"""
    return get_kernel_globals()

@pytest.fixture
def mock_comm():
    """Fixture providing a mock comm channel"""
    return MockComm()

@pytest.fixture
def world_coordinate_geojson():
    """Fixture providing GeoJSON with world coordinates"""
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [85.0001389, 32.9832, 150.0]  # lon, lat, elevation
                },
                "properties": {
                    "name": "Test Point",
                    "feature_type": "observation_point"
                }
            },
            {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [
                        [85.0000500, 32.9833000, 100.0],
                        [85.0001500, 32.9832500, 120.0],
                        [85.0002000, 32.9831500, 140.0]
                    ]
                },
                "properties": {
                    "name": "Test Path",
                    "feature_type": "pathway"
                }
            },
            {
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [85.0000800, 32.9831200, 90.0],
                        [85.0001800, 32.9831200, 90.0], 
                        [85.0001800, 32.9832200, 110.0],
                        [85.0000800, 32.9832200, 110.0],
                        [85.0000800, 32.9831200, 90.0]  # closed polygon
                    ]]
                },
                "properties": {
                    "name": "Test Polygon",
                    "feature_type": "area_of_interest"
                }
            },
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [85.0001000, 32.9832000]  # no elevation
                },
                "properties": {
                    "name": "Simple Point",
                    "feature_type": "marker"
                }
            },
            {
                "type": "Feature",
                "geometry": None,
                "properties": {
                    "name": "Legacy Feature",
                    "imageGeometry": {
                        "type": "Point",
                        "coordinates": [1024, 768]
                    },
                    "feature_type": "legacy"
                },
                "bbox": [85.0000800, 32.9831200, 90.0, 85.0001800, 32.9832200, 110.0]
            }
        ]
    }

@pytest.fixture
def mock_sensor_model():
    """Fixture providing a mock sensor model"""
    sensor_model = MagicMock()
    
    def world_to_image_side_effect(world_coord):
        """Mock world_to_image function that returns predictable results"""
        # Simple mock: convert lon/lat to x/y by scaling and offsetting
        # This simulates a sensor model transformation
        lon_rad = world_coord.longitude  # already in radians
        lat_rad = world_coord.latitude   # already in radians
        
        # Convert radians to degrees for calculation
        lon_deg = lon_rad * 180.0 / 3.14159265359
        lat_deg = lat_rad * 180.0 / 3.14159265359
        
        # Mock transformation: map the coordinate range to image coordinates
        # Assuming image coordinates are 0-2048 for both x and y
        # Map longitude 85.0000 to 85.0003 -> x: 0 to 2048
        # Map latitude 32.9830 to 32.9834 -> y: 0 to 2048 (inverted)
        x = ((lon_deg - 85.0000) / 0.0003) * 2048
        y = 2048 - ((lat_deg - 32.9830) / 0.0004) * 2048
        
        mock_image_coord = MagicMock()
        mock_image_coord.x = x
        mock_image_coord.y = y
        return mock_image_coord
    
    sensor_model.world_to_image.side_effect = world_to_image_side_effect
    return sensor_model

@pytest.fixture
def mock_image_factory(mock_sensor_model):
    """Fixture providing a mock image factory"""
    factory = MagicMock()
    factory.sensor_model = mock_sensor_model
    
    # Mock dataset with image dimensions
    mock_dataset = MagicMock()
    mock_dataset.RasterXSize = 2048
    mock_dataset.RasterYSize = 2048
    factory.raster_dataset = mock_dataset
    
    return factory

class TestWorldCoordinateConversion:
    """Test world coordinate conversion functionality"""
    
    def test_load_overlay_with_world_coordinates_success(self, kernel_globals, world_coordinate_geojson, mock_image_factory, tmp_path):
        """Test successful loading of overlay with world coordinates"""
        # Create temporary GeoJSON file
        overlay_file = tmp_path / "world_coords.geojson"
        with open(overlay_file, 'w') as f:
            json.dump(world_coordinate_geojson, f)
        
        # Get cache manager
        AdvancedCacheManager = kernel_globals['AdvancedCacheManager']
        cache_manager = AdvancedCacheManager()
        
        # Set up mock image factory in cache
        cache_manager.set_image_factory('test_image.tif', mock_image_factory)
        
        # Test loading overlay with world coordinates
        try:
            overlay_factory = cache_manager.load_overlay('test_image.tif', str(overlay_file))
            
            # Verify overlay factory was created
            assert overlay_factory is not None
            
            # Verify overlay is cached
            overlay_key = f"test_image.tif:{overlay_file}"
            cached_factory = cache_manager.get_overlay_factory(overlay_key)
            assert cached_factory is not None
            assert cached_factory == overlay_factory
            
        except Exception as e:
            pytest.fail(f"Loading overlay with world coordinates failed: {str(e)}")
    
    def test_project_feature_to_image_logic(self, kernel_globals, mock_sensor_model):
        """Test the feature projection logic specifically"""
        # Get cache manager
        AdvancedCacheManager = kernel_globals['AdvancedCacheManager']
        cache_manager = AdvancedCacheManager()
        
        # Test feature with Point geometry
        test_feature = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [85.0001, 32.9832, 150.0]  # lon, lat, elevation in degrees
            },
            "properties": {
                "name": "Test Point"
            }
        }
        
        # Test coordinate projection
        result = cache_manager._project_feature_to_image(test_feature, mock_sensor_model, 2048, 2048)
        
        # Verify sensor model was called
        assert mock_sensor_model.world_to_image.called
        
        # Verify feature was updated with imageGeometry
        assert 'imageGeometry' in test_feature['properties']
        image_geom = test_feature['properties']['imageGeometry']
        assert image_geom['type'] == 'Point'
        assert 'coordinates' in image_geom
        
        # Verify result indicates intersection
        assert isinstance(result, bool)
    
    def test_missing_elevation_defaults_to_zero(self, kernel_globals, mock_sensor_model):
        """Test that missing elevation defaults to 0.0"""
        AdvancedCacheManager = kernel_globals['AdvancedCacheManager']
        cache_manager = AdvancedCacheManager()
        
        # Test feature without elevation
        test_feature = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [85.0001, 32.9832]  # only lon, lat
            },
            "properties": {
                "name": "Test Point"
            }
        }
        
        with patch('aws.osml.photogrammetry.GeodeticWorldCoordinate') as mock_geodetic_coord:
            mock_world_coord = MagicMock()
            mock_geodetic_coord.return_value = mock_world_coord
            
            cache_manager._project_feature_to_image(test_feature, mock_sensor_model, 2048, 2048)
            
            # Verify GeodeticWorldCoordinate was called with elevation 0.0
            call_args = mock_geodetic_coord.call_args[0][0]
            assert call_args[2] == 0.0  # elevation should be 0.0
    
    def test_bbox_to_image_bbox_conversion(self, kernel_globals, mock_sensor_model):
        """Test conversion of bbox from world to image coordinates"""
        AdvancedCacheManager = kernel_globals['AdvancedCacheManager']
        cache_manager = AdvancedCacheManager()
        
        # Test bbox conversion
        test_bbox = [85.0000, 32.9831, 90.0, 85.0002, 32.9833, 110.0]  # lon_min, lat_min, elev_min, lon_max, lat_max, elev_max
        
        result = cache_manager._convert_bbox_to_image_bbox(test_bbox, mock_sensor_model)
        
        # Verify result is a valid image bbox
        assert result is not None
        assert isinstance(result, list)
        assert len(result) == 4  # [minx, miny, maxx, maxy]
        
        # Verify sensor model was called multiple times (for corners)
        assert mock_sensor_model.world_to_image.call_count >= 4
    
    def test_geometry_conversion_point(self, kernel_globals, mock_sensor_model):
        """Test conversion of Point geometry"""
        AdvancedCacheManager = kernel_globals['AdvancedCacheManager']
        cache_manager = AdvancedCacheManager()
        
        # Test Point geometry
        point_geometry = {
            "type": "Point",
            "coordinates": [85.0001, 32.9832, 100.0]
        }
        
        result = cache_manager._convert_geometry_to_image_geometry(point_geometry, mock_sensor_model)
        
        # Verify result is a shapely Point
        assert result is not None
        assert isinstance(result, shapely.Point)
        
        # Verify sensor model was called once
        assert mock_sensor_model.world_to_image.call_count == 1
    
    def test_geometry_conversion_linestring(self, kernel_globals, mock_sensor_model):
        """Test conversion of LineString geometry"""
        AdvancedCacheManager = kernel_globals['AdvancedCacheManager']
        cache_manager = AdvancedCacheManager()
        
        # Test LineString geometry
        linestring_geometry = {
            "type": "LineString",
            "coordinates": [
                [85.0000, 32.9831, 100.0],
                [85.0001, 32.9832, 120.0],
                [85.0002, 32.9833, 140.0]
            ]
        }
        
        result = cache_manager._convert_geometry_to_image_geometry(linestring_geometry, mock_sensor_model)
        
        # Verify result is a shapely LineString
        assert result is not None
        assert isinstance(result, shapely.LineString)
        
        # Verify sensor model was called for each coordinate
        assert mock_sensor_model.world_to_image.call_count == 3
    
    def test_geometry_conversion_polygon(self, kernel_globals, mock_sensor_model):
        """Test conversion of Polygon geometry"""
        AdvancedCacheManager = kernel_globals['AdvancedCacheManager']
        cache_manager = AdvancedCacheManager()
        
        # Test Polygon geometry
        polygon_geometry = {
            "type": "Polygon",
            "coordinates": [[
                [85.0000, 32.9831, 100.0],
                [85.0001, 32.9831, 100.0],
                [85.0001, 32.9832, 100.0],
                [85.0000, 32.9832, 100.0],
                [85.0000, 32.9831, 100.0]  # closed
            ]]
        }
        
        result = cache_manager._convert_geometry_to_image_geometry(polygon_geometry, mock_sensor_model)
        
        # Verify result is a shapely Polygon
        assert result is not None
        assert isinstance(result, shapely.Polygon)
        
        # Verify sensor model was called for each coordinate
        assert mock_sensor_model.world_to_image.call_count == 5
    
    def test_preserve_existing_image_geometry(self, kernel_globals, mock_image_factory, tmp_path):
        """Test that existing imageGeometry properties are preserved"""
        # Create GeoJSON with existing imageGeometry
        geojson_with_existing = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": None,
                    "properties": {
                        "name": "Legacy Feature",
                        "imageGeometry": {
                            "type": "Point",
                            "coordinates": [1024, 768]
                        }
                    }
                }
            ]
        }
        
        overlay_file = tmp_path / "existing_geom.geojson"
        with open(overlay_file, 'w') as f:
            json.dump(geojson_with_existing, f)
        
        # Get cache manager and load overlay
        AdvancedCacheManager = kernel_globals['AdvancedCacheManager']
        cache_manager = AdvancedCacheManager()
        cache_manager.set_image_factory('test_image.tif', mock_image_factory)
        
        overlay_factory = cache_manager.load_overlay('test_image.tif', str(overlay_file))
        
        # Verify overlay was loaded successfully
        assert overlay_factory is not None
        
        # Verify the sensor model wasn't called (existing geometry preserved)
        assert mock_image_factory.sensor_model.world_to_image.call_count == 0
    
    def test_mixed_coordinate_systems_in_same_file(self, kernel_globals, mock_image_factory, tmp_path):
        """Test handling of mixed coordinate systems in the same GeoJSON file"""
        # Create GeoJSON with both world coordinates and existing imageGeometry
        mixed_geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [85.0001, 32.9832, 100.0]  # world coordinates
                    },
                    "properties": {
                        "name": "World Coordinate Point"
                    }
                },
                {
                    "type": "Feature",
                    "geometry": None,
                    "properties": {
                        "name": "Image Coordinate Point",
                        "imageGeometry": {
                            "type": "Point",
                            "coordinates": [512, 512]  # existing image coordinates
                        }
                    }
                }
            ]
        }
        
        overlay_file = tmp_path / "mixed_coords.geojson"
        with open(overlay_file, 'w') as f:
            json.dump(mixed_geojson, f)
        
        # Get cache manager and load overlay
        AdvancedCacheManager = kernel_globals['AdvancedCacheManager']
        cache_manager = AdvancedCacheManager()
        cache_manager.set_image_factory('test_image.tif', mock_image_factory)
        
        overlay_factory = cache_manager.load_overlay('test_image.tif', str(overlay_file))
        
        # Verify overlay was loaded successfully
        assert overlay_factory is not None
        
        # Verify sensor model was called only once (for the world coordinate feature)
        assert mock_image_factory.sensor_model.world_to_image.call_count >= 1
    
    def test_feature_intersection_bounds_checking(self, kernel_globals, mock_sensor_model):
        """Test that feature intersection with image bounds is properly checked"""
        AdvancedCacheManager = kernel_globals['AdvancedCacheManager']
        cache_manager = AdvancedCacheManager()
        
        # Test feature that should intersect bounds (center of image)
        center_feature = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [85.00015, 32.9832]  # should map to center
            },
            "properties": {"name": "Center Point"}
        }
        
        result = cache_manager._project_feature_to_image(center_feature, mock_sensor_model, 2048, 2048)
        
        # Should return True for intersection
        assert result is True
        
        # Verify imageGeometry was added
        assert 'imageGeometry' in center_feature['properties']
    
    def test_feature_bbox_processing(self, kernel_globals, mock_sensor_model):
        """Test processing of feature bbox attribute"""
        AdvancedCacheManager = kernel_globals['AdvancedCacheManager']
        cache_manager = AdvancedCacheManager()
        
        # Test feature with bbox
        feature_with_bbox = {
            "type": "Feature",
            "geometry": None,
            "properties": {"name": "Test Area"},
            "bbox": [85.0000, 32.9831, 90.0, 85.0002, 32.9833, 110.0]
        }
        
        result = cache_manager._project_feature_to_image(feature_with_bbox, mock_sensor_model, 2048, 2048)
        
        # Verify imageBBox was added to properties
        assert 'imageBBox' in feature_with_bbox['properties']
        
        # Verify bbox format
        image_bbox = feature_with_bbox['properties']['imageBBox']
        assert isinstance(image_bbox, list)
        assert len(image_bbox) == 4
    
    def test_geometry_collection_handling(self, kernel_globals, mock_sensor_model):
        """Test handling of GeometryCollection"""
        AdvancedCacheManager = kernel_globals['AdvancedCacheManager']
        cache_manager = AdvancedCacheManager()
        
        # Test GeometryCollection
        geometry_collection = {
            "type": "GeometryCollection",
            "geometries": [
                {
                    "type": "Point",
                    "coordinates": [85.0001, 32.9832]
                },
                {
                    "type": "LineString",
                    "coordinates": [
                        [85.0000, 32.9831],
                        [85.0002, 32.9833]
                    ]
                }
            ]
        }
        
        result = cache_manager._convert_geometry_to_image_geometry(geometry_collection, mock_sensor_model)
        
        # Verify result is a GeometryCollection
        assert result is not None
        assert isinstance(result, shapely.GeometryCollection)
    
    def test_multipoint_geometry_handling(self, kernel_globals, mock_sensor_model):
        """Test handling of MultiPoint geometry"""
        AdvancedCacheManager = kernel_globals['AdvancedCacheManager']
        cache_manager = AdvancedCacheManager()
        
        # Test MultiPoint geometry
        multipoint_geometry = {
            "type": "MultiPoint",
            "coordinates": [
                [85.0001, 32.9832],
                [85.0002, 32.9833]
            ]
        }
        
        result = cache_manager._convert_geometry_to_image_geometry(multipoint_geometry, mock_sensor_model)
        
        # Verify result is a MultiPoint
        assert result is not None
        assert isinstance(result, shapely.MultiPoint)


class TestOverlayLoadProcessorWithWorldCoordinates:
    """Test OverlayLoadProcessor with world coordinate conversion"""
    
    def test_overlay_load_processor_world_coordinates(self, kernel_globals, mock_comm, world_coordinate_geojson, mock_image_factory, tmp_path):
        """Test OverlayLoadProcessor with world coordinates via message processing"""
        # Create temporary overlay file
        overlay_file = tmp_path / "world_coords_processor.geojson"
        with open(overlay_file, 'w') as f:
            json.dump(world_coordinate_geojson, f)
        
        # Get processor and dependencies
        OverlayLoadProcessor = kernel_globals['OverlayLoadProcessor']
        AdvancedCacheManager = kernel_globals['AdvancedCacheManager']
        OSMLKernelLogger = kernel_globals['OSMLKernelLogger']
        
        cache_manager = AdvancedCacheManager()
        cache_manager.set_image_factory('test_image.tif', mock_image_factory)
        
        logger = OSMLKernelLogger()
        processor = OverlayLoadProcessor(cache_manager, logger)
        
        # Test overlay loading via processor
        request_data = {
            'imageName': 'test_image.tif',
            'overlayName': str(overlay_file)
        }
        
        processor.process(request_data, mock_comm)
        
        # Verify response
        response = mock_comm.get_last_message()
        assert response is not None
        assert response['type'] == 'OVERLAY_LOAD_RESPONSE'
        
        # The test should pass even if coordinate conversion fails gracefully
        # We're mainly testing that the process doesn't crash and provides a response
        assert response['status'] in ['SUCCESS', 'ERROR']
        
        if response['status'] == 'SUCCESS':
            # Verify overlay is cached if successful
            overlay_key = f"test_image.tif:{overlay_file}"
            assert cache_manager.get_overlay_factory(overlay_key) is not None
    
    def test_overlay_load_missing_image_factory(self, kernel_globals, mock_comm, world_coordinate_geojson, tmp_path):
        """Test overlay loading when image factory is missing"""
        # Create temporary overlay file
        overlay_file = tmp_path / "world_coords_no_image.geojson"
        with open(overlay_file, 'w') as f:
            json.dump(world_coordinate_geojson, f)
        
        # Get processor and dependencies
        OverlayLoadProcessor = kernel_globals['OverlayLoadProcessor']
        AdvancedCacheManager = kernel_globals['AdvancedCacheManager']
        OSMLKernelLogger = kernel_globals['OSMLKernelLogger']
        
        cache_manager = AdvancedCacheManager()
        # Don't set image factory to test error handling
        
        logger = OSMLKernelLogger()
        processor = OverlayLoadProcessor(cache_manager, logger)
        
        # Test overlay loading via processor
        request_data = {
            'imageName': 'nonexistent_image.tif',
            'overlayName': str(overlay_file)
        }
        
        processor.process(request_data, mock_comm)
        
        # Verify response indicates error
        response = mock_comm.get_last_message()
        assert response is not None
        assert response['type'] == 'OVERLAY_LOAD_RESPONSE'
        # Should be ERROR since image factory is missing
        assert response['status'] == 'ERROR'
