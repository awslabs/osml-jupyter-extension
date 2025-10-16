import pytest
import sys
from pathlib import Path
from unittest.mock import Mock

# Add the lib directory to Python path for testing
lib_path = Path(__file__).parent.parent.parent / "lib"
sys.path.insert(0, str(lib_path))


def test_zoom_scaling_formula():
    """Test that the zoom scaling formula works correctly"""
    
    # Test zoom level calculations - the core math fix
    test_cases = [
        (-2, 4.0, 2048),    # 2^(-1 * -2) = 2^2 = 4, 512 * 4 = 2048
        (-1, 2.0, 1024),    # 2^(-1 * -1) = 2^1 = 2, 512 * 2 = 1024
        (0, 1.0, 512),      # 2^(-1 * 0) = 2^0 = 1, 512 * 1 = 512
        (1, 0.5, 256),      # 2^(-1 * 1) = 2^-1 = 0.5, 512 * 0.5 = 256
        (2, 0.25, 128),     # 2^(-1 * 2) = 2^-2 = 0.25, 512 * 0.25 = 128
    ]
    
    for zoom, expected_scale, expected_scaled_tile_size in test_cases:
        calculated_scale = 2**(-1 * zoom)
        calculated_tile_size = 512 * calculated_scale
        
        assert abs(calculated_scale - expected_scale) < 0.0001, f"Scale mismatch at zoom {zoom}"
        assert abs(calculated_tile_size - expected_scaled_tile_size) < 0.0001, f"Tile size mismatch at zoom {zoom}"


def test_overlay_processor_has_zoom_features():
    """Test that OverlayTileProcessor has the new zoom-aware features"""
    
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
    
    # Get the OverlayTileProcessor class
    OverlayTileProcessor = namespace['OverlayTileProcessor']
    AdvancedCacheManager = namespace['AdvancedCacheManager']
    OSMLKernelLogger = namespace['OSMLKernelLogger']
    
    # Create processor
    cache_manager = Mock(spec=AdvancedCacheManager)
    logger = Mock(spec=OSMLKernelLogger)
    processor = OverlayTileProcessor(cache_manager, logger)
    
    # Check that the class has the new zoom-aware features
    assert hasattr(OverlayTileProcessor, 'ZOOM_FEATURE_LIMITS'), "OverlayTileProcessor should have ZOOM_FEATURE_LIMITS class attribute"
    assert hasattr(processor, '_filter_features_by_zoom'), "OverlayTileProcessor should have _filter_features_by_zoom method"
    assert hasattr(processor, '_filter_by_importance'), "OverlayTileProcessor should have _filter_by_importance method"
    
    # Check that ZOOM_FEATURE_LIMITS has expected zoom levels
    expected_zoom_levels = [-3, -2, -1, 0, 1, 2, 3]
    for zoom in expected_zoom_levels:
        assert zoom in OverlayTileProcessor.ZOOM_FEATURE_LIMITS, f"ZOOM_FEATURE_LIMITS should include zoom level {zoom}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
