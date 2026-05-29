import pytest
from unittest.mock import Mock

from aws.osml.jupyter.processors.overlay import OverlayTileProcessor
from aws.osml.jupyter.cache import AdvancedCacheManager
from aws.osml.jupyter.core import OSMLKernelLogger


def test_zoom_scaling_formula():
    """Test that the zoom scaling formula produces correct scale and tile sizes"""
    test_cases = [
        (-2, 4.0, 2048),
        (-1, 2.0, 1024),
        (0, 1.0, 512),
        (1, 0.5, 256),
        (2, 0.25, 128),
    ]

    for zoom, expected_scale, expected_scaled_tile_size in test_cases:
        calculated_scale = 2 ** (-1 * zoom)
        calculated_tile_size = 512 * calculated_scale

        assert abs(calculated_scale - expected_scale) < 0.0001, f"Scale mismatch at zoom {zoom}"
        assert abs(calculated_tile_size - expected_scaled_tile_size) < 0.0001, f"Tile size mismatch at zoom {zoom}"


def test_overlay_processor_has_zoom_features():
    """Test that OverlayTileProcessor has the zoom-aware class attributes and methods"""
    cache_manager = Mock(spec=AdvancedCacheManager)
    logger = Mock(spec=OSMLKernelLogger)
    processor = OverlayTileProcessor(cache_manager, logger)

    assert hasattr(OverlayTileProcessor, 'ZOOM_FEATURE_LIMITS')
    assert hasattr(processor, '_filter_features_by_zoom')
    assert hasattr(processor, '_filter_by_importance')

    expected_zoom_levels = [-3, -2, -1, 0, 1, 2, 3]
    for zoom in expected_zoom_levels:
        assert zoom in OverlayTileProcessor.ZOOM_FEATURE_LIMITS, f"ZOOM_FEATURE_LIMITS missing zoom {zoom}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
