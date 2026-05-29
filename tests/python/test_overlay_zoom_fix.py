import pytest
from unittest.mock import Mock

import shapely

from aws.osml.jupyter.processors.overlay import OverlayTileProcessor
from aws.osml.jupyter.cache import AdvancedCacheManager
from aws.osml.jupyter.core import OSMLKernelLogger


def _make_processor():
    cache_manager = Mock(spec=AdvancedCacheManager)
    logger = Mock(spec=OSMLKernelLogger)
    return OverlayTileProcessor(cache_manager, logger), cache_manager


def test_overlay_processor_zoom_scaling():
    """Test that OverlayTileProcessor correctly scales coordinates by zoom level"""
    processor, cache_manager = _make_processor()

    mock_factory = Mock()
    mock_factory.find_intersects.return_value = []
    cache_manager.get_overlay_index.return_value = mock_factory

    mock_comm = Mock()

    test_cases = [
        (-2, 4.0, 2048),
        (-1, 2.0, 1024),
        (0, 1.0, 512),
        (1, 0.5, 256),
        (2, 0.25, 128),
    ]

    for zoom, expected_scale, expected_scaled_tile_size in test_cases:
        mock_factory.find_intersects.reset_mock()

        data = {
            'imageName': 'test_image.tiff',
            'overlayName': 'test_overlay.geojson',
            'zoom': zoom,
            'row': 1,
            'col': 2,
        }

        processor.process(data, mock_comm)

        assert mock_factory.find_intersects.called
        call_args = mock_factory.find_intersects.call_args[0]
        bbox = call_args[0]

        expected_min_x = 2 * expected_scaled_tile_size
        expected_min_y = 1 * expected_scaled_tile_size
        expected_max_x = 3 * expected_scaled_tile_size
        expected_max_y = 2 * expected_scaled_tile_size

        assert bbox.bounds[0] == expected_min_x, f"Zoom {zoom}: Wrong min_x"
        assert bbox.bounds[1] == expected_min_y, f"Zoom {zoom}: Wrong min_y"
        assert bbox.bounds[2] == expected_max_x, f"Zoom {zoom}: Wrong max_x"
        assert bbox.bounds[3] == expected_max_y, f"Zoom {zoom}: Wrong max_y"


def test_feature_filtering_by_zoom():
    """Test that _filter_features_by_zoom returns all features when under every limit"""
    processor, _ = _make_processor()

    test_features = [
        {'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [i, i]}, 'properties': {'id': i}}
        for i in range(1000)
    ]

    for zoom in [-3, -1, 0, 2]:
        filtered = processor._filter_features_by_zoom(test_features, zoom)
        assert len(filtered) == 1000, f"Zoom {zoom}: expected 1000 features, got {len(filtered)}"

    filtered_small = processor._filter_features_by_zoom(test_features[:10], -3)
    assert len(filtered_small) == 10


def test_feature_importance_filtering():
    """Test that _filter_by_importance returns the N largest features"""
    processor, _ = _make_processor()

    test_features = [
        {
            'type': 'Feature',
            'geometry': {'type': 'Polygon', 'coordinates': [[[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]]]},
            'properties': {'id': 'large', 'area': 400},
        },
        {
            'type': 'Feature',
            'geometry': {'type': 'Polygon', 'coordinates': [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]},
            'properties': {'id': 'medium', 'area': 100},
        },
        {
            'type': 'Feature',
            'geometry': {'type': 'Polygon', 'coordinates': [[[0, 0], [5, 0], [5, 5], [0, 5], [0, 0]]]},
            'properties': {'id': 'small', 'area': 25},
        },
        {
            'type': 'Feature',
            'geometry': {'type': 'Point', 'coordinates': [0, 0]},
            'properties': {'id': 'point', 'area': 0},
        },
    ]

    filtered = processor._filter_by_importance(test_features, 2)

    assert len(filtered) == 2
    assert filtered[0]['properties']['id'] == 'large'
    assert filtered[1]['properties']['id'] == 'medium'


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
