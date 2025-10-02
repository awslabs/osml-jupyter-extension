import pytest
import sys
import os
from pathlib import Path
from unittest.mock import Mock, MagicMock
import shapely.geometry

# Add the lib directory to Python path for testing
lib_path = Path(__file__).parent.parent.parent / "lib"
sys.path.insert(0, str(lib_path))

# Import the classes from the concatenated kernel setup
def test_overlay_processor_zoom_scaling():
    """Test that OverlayTileProcessor correctly scales coordinates by zoom level"""
    
    # Execute the kernel setup code to get the classes
    kernel_file = lib_path / "kernel" / "kernel-setup.py"
    namespace = {}
    
    # Mock get_ipython() function to avoid errors in test environment
    mock_ipython = Mock()
    mock_ipython.kernel.comm_manager.register_target = Mock()
    namespace['get_ipython'] = lambda: mock_ipython
    
    with open(kernel_file, 'r') as f:
        kernel_code = f.read()
    exec(kernel_code, namespace)
    
    # Get the classes we need
    OverlayTileProcessor = namespace['OverlayTileProcessor']
    AdvancedCacheManager = namespace['AdvancedCacheManager']
    OSMLKernelLogger = namespace['OSMLKernelLogger']
    
    # Create processor with mock dependencies
    cache_manager = Mock(spec=AdvancedCacheManager)
    logger = Mock(spec=OSMLKernelLogger)
    processor = OverlayTileProcessor(cache_manager, logger)
    
    # Mock the overlay factory
    mock_factory = Mock()
    mock_factory.find_intersects.return_value = []
    cache_manager.get_overlay_factory.return_value = mock_factory
    
    # Mock comm
    mock_comm = Mock()
    
    # Test data for different zoom levels
    test_cases = [
        # zoom, expected_scale, expected_scaled_tile_size
        (-2, 4.0, 2048),    # 2^(-1 * -2) = 2^2 = 4
        (-1, 2.0, 1024),    # 2^(-1 * -1) = 2^1 = 2  
        (0, 1.0, 512),      # 2^(-1 * 0) = 2^0 = 1
        (1, 0.5, 256),      # 2^(-1 * 1) = 2^-1 = 0.5
        (2, 0.25, 128),     # 2^(-1 * 2) = 2^-2 = 0.25
    ]
    
    for zoom, expected_scale, expected_scaled_tile_size in test_cases:
        # Reset mock
        mock_factory.find_intersects.reset_mock()
        
        # Test data
        data = {
            'imageName': 'test_image.tiff',
            'overlayName': 'test_overlay.geojson', 
            'zoom': zoom,
            'row': 1,
            'col': 2
        }
        
        # Process the request
        processor.process(data, mock_comm)
        
        # Verify find_intersects was called with correctly scaled bounding box
        assert mock_factory.find_intersects.called
        call_args = mock_factory.find_intersects.call_args[0]
        bbox = call_args[0]
        
        # Expected coordinates based on row=1, col=2
        expected_min_x = 2 * expected_scaled_tile_size
        expected_min_y = 1 * expected_scaled_tile_size  
        expected_max_x = 3 * expected_scaled_tile_size
        expected_max_y = 2 * expected_scaled_tile_size
        
        # Verify bounding box coordinates
        assert bbox.bounds[0] == expected_min_x, f"Zoom {zoom}: Wrong min_x. Expected {expected_min_x}, got {bbox.bounds[0]}"
        assert bbox.bounds[1] == expected_min_y, f"Zoom {zoom}: Wrong min_y. Expected {expected_min_y}, got {bbox.bounds[1]}" 
        assert bbox.bounds[2] == expected_max_x, f"Zoom {zoom}: Wrong max_x. Expected {expected_max_x}, got {bbox.bounds[2]}"
        assert bbox.bounds[3] == expected_max_y, f"Zoom {zoom}: Wrong max_y. Expected {expected_max_y}, got {bbox.bounds[3]}"


def test_feature_filtering_by_zoom():
    """Test that features are filtered based on zoom level limits"""
    
    # Execute the kernel setup code to get the classes
    kernel_file = lib_path / "kernel" / "kernel-setup.py"
    namespace = {}
    
    # Mock get_ipython() function to avoid errors in test environment
    mock_ipython = Mock()
    mock_ipython.kernel.comm_manager.register_target = Mock()
    namespace['get_ipython'] = lambda: mock_ipython
    
    with open(kernel_file, 'r') as f:
        kernel_code = f.read()
    exec(kernel_code, namespace)
    
    # Get the classes we need
    OverlayTileProcessor = namespace['OverlayTileProcessor']
    AdvancedCacheManager = namespace['AdvancedCacheManager']
    OSMLKernelLogger = namespace['OSMLKernelLogger']
    
    # Create processor
    cache_manager = Mock(spec=AdvancedCacheManager)
    logger = Mock(spec=OSMLKernelLogger)
    processor = OverlayTileProcessor(cache_manager, logger)
    
    # Create test features (more than the limits)
    test_features = []
    for i in range(1000):  # Create 1000 features
        feature = {
            'type': 'Feature',
            'geometry': {
                'type': 'Point',
                'coordinates': [i, i]
            },
            'properties': {'id': i}
        }
        test_features.append(feature)
    
    # Test filtering at different zoom levels
    test_cases = [
        (-3, 50),   # Should limit to 50 features
        (-1, 200),  # Should limit to 200 features  
        (0, 500),   # Should limit to 500 features
        (2, 1000),  # Should return all 1000 features (under limit of 2000)
    ]
    
    for zoom, expected_max_count in test_cases:
        filtered = processor._filter_features_by_zoom(test_features, zoom)
        
        if zoom == 2:
            # At zoom 2, we expect all 1000 features since it's under the limit
            assert len(filtered) == 1000, f"Zoom {zoom}: Expected 1000 features, got {len(filtered)}"
        else:
            # At other zoom levels, we expect the limit to be applied
            assert len(filtered) <= expected_max_count, f"Zoom {zoom}: Expected max {expected_max_count} features, got {len(filtered)}"
            assert len(filtered) == expected_max_count, f"Zoom {zoom}: Expected exactly {expected_max_count} features, got {len(filtered)}"


def test_feature_importance_filtering():
    """Test that features are filtered by importance (area) at negative zoom levels"""
    
    # Execute the kernel setup code to get the classes  
    kernel_file = lib_path / "kernel" / "kernel-setup.py"
    namespace = {}
    
    # Mock get_ipython() function to avoid errors in test environment
    mock_ipython = Mock()
    mock_ipython.kernel.comm_manager.register_target = Mock()
    namespace['get_ipython'] = lambda: mock_ipython
    
    with open(kernel_file, 'r') as f:
        kernel_code = f.read()
    exec(kernel_code, namespace)
    
    # Get the classes we need
    OverlayTileProcessor = namespace['OverlayTileProcessor']
    AdvancedCacheManager = namespace['AdvancedCacheManager'] 
    OSMLKernelLogger = namespace['OSMLKernelLogger']
    
    # Create processor
    cache_manager = Mock(spec=AdvancedCacheManager)
    logger = Mock(spec=OSMLKernelLogger)
    processor = OverlayTileProcessor(cache_manager, logger)
    
    # Create test features with different sizes (polygons with different areas)
    test_features = [
        # Large polygon (area = 400)
        {
            'type': 'Feature',
            'geometry': {
                'type': 'Polygon', 
                'coordinates': [[[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]]]
            },
            'properties': {'id': 'large', 'area': 400}
        },
        # Medium polygon (area = 100)
        {
            'type': 'Feature',
            'geometry': {
                'type': 'Polygon',
                'coordinates': [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]
            },
            'properties': {'id': 'medium', 'area': 100}
        },
        # Small polygon (area = 25)  
        {
            'type': 'Feature',
            'geometry': {
                'type': 'Polygon',
                'coordinates': [[[0, 0], [5, 0], [5, 5], [0, 5], [0, 0]]]
            },
            'properties': {'id': 'small', 'area': 25}
        },
        # Point (area = 0)
        {
            'type': 'Feature', 
            'geometry': {
                'type': 'Point',
                'coordinates': [0, 0]
            },
            'properties': {'id': 'point', 'area': 0}
        }
    ]
    
    # Filter by importance (should return larger features first)
    filtered = processor._filter_by_importance(test_features, 2)
    
    # Should return 2 features: the largest and medium ones
    assert len(filtered) == 2
    
    # Should be sorted by area (largest first)
    assert filtered[0]['properties']['id'] == 'large'
    assert filtered[1]['properties']['id'] == 'medium'


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
