"""
Tests for overlay lifecycle and model-stub message types.

Note: EndpointListProcessor and ModelTileProcessor are stubs (Phase 1 decision).
Their registration is verified here; their process() raises NotImplementedError
by design. The original boto3/SageMaker tests have been removed because the
underlying inference code was intentionally stripped from the kernel package.
"""

import json
import pytest
from unittest.mock import Mock, MagicMock
from pathlib import Path
from fixtures.mock_comm import MockComm

from aws.osml.jupyter.cache import AdvancedCacheManager, ImageSession
from aws.osml.jupyter.core import OSMLKernelLogger
from aws.osml.jupyter.main import _build_registry
from aws.osml.jupyter.processors.overlay import OverlayLoadProcessor, OverlayUnloadProcessor
from aws.osml.jupyter.processors.model import EndpointListProcessor, ModelTileProcessor


@pytest.fixture
def mock_comm():
    return MockComm()


@pytest.fixture
def sample_overlay_data():
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [100.0, 50.0]},
                "properties": {
                    "name": "Test Feature",
                    "imageGeometry": {"type": "Point", "coordinates": [256.0, 256.0]},
                },
            }
        ],
    }


def _make_cache_with_image(image_name='test_image.tif'):
    cache_manager = AdvancedCacheManager()
    logger = OSMLKernelLogger()
    mock_session = ImageSession(
        reader=MagicMock(),
        asset=MagicMock(),
        pyramid=MagicMock(),
        display=MagicMock(),
        chip_factory=MagicMock(),
        sensor_model=MagicMock(),
        width=512,
        height=512,
    )
    cache_manager.image_sessions[image_name] = mock_session
    return cache_manager, logger


class TestOverlayLoadProcessor:
    """Test OverlayLoadProcessor functionality"""

    def test_overlay_load_success(self, mock_comm, sample_overlay_data, tmp_path):
        """Test successful overlay loading"""
        overlay_file = tmp_path / "test_overlay.geojson"
        overlay_file.write_text(json.dumps(sample_overlay_data))

        image_name = 'test_image.tif'
        cache_manager, logger = _make_cache_with_image(image_name)
        processor = OverlayLoadProcessor(cache_manager, logger)

        processor.process({'imageName': image_name, 'overlayName': str(overlay_file)}, mock_comm)

        response = mock_comm.get_last_message()
        assert response is not None
        assert response['type'] == 'OVERLAY_LOAD_RESPONSE'
        assert response['status'] == 'SUCCESS'
        assert response['imageName'] == image_name
        assert response['overlayName'] == str(overlay_file)

        overlay_key = f"{image_name}:{overlay_file}"
        assert cache_manager.get_overlay_index(overlay_key) is not None

    def test_overlay_load_missing_fields(self, mock_comm):
        """Test overlay loading with missing required fields"""
        cache_manager, logger = _make_cache_with_image()
        processor = OverlayLoadProcessor(cache_manager, logger)

        processor.process({'imageName': 'test_image.tif'}, mock_comm)

        response = mock_comm.get_last_message()
        assert response is not None
        assert response['type'] == 'OVERLAY_LOAD_RESPONSE'
        assert response['status'] == 'ERROR'

    def test_overlay_load_file_not_found(self, mock_comm):
        """Test overlay loading with non-existent file"""
        cache_manager, logger = _make_cache_with_image()
        processor = OverlayLoadProcessor(cache_manager, logger)

        processor.process({'imageName': 'test_image.tif', 'overlayName': '/nonexistent/file.geojson'}, mock_comm)

        response = mock_comm.get_last_message()
        assert response is not None
        assert response['type'] == 'OVERLAY_LOAD_RESPONSE'
        assert response['status'] == 'ERROR'


class TestOverlayUnloadProcessor:
    """Test OverlayUnloadProcessor functionality"""

    def test_overlay_unload_success(self, mock_comm, sample_overlay_data, tmp_path):
        """Test successful overlay unloading"""
        overlay_file = tmp_path / "test_overlay.geojson"
        overlay_file.write_text(json.dumps(sample_overlay_data))

        image_name = 'test_image.tif'
        cache_manager, logger = _make_cache_with_image(image_name)

        cache_manager.load_overlay(image_name, str(overlay_file))
        overlay_key = f"{image_name}:{overlay_file}"
        assert cache_manager.get_overlay_index(overlay_key) is not None

        processor = OverlayUnloadProcessor(cache_manager, logger)
        processor.process({'imageName': image_name, 'overlayName': str(overlay_file)}, mock_comm)

        response = mock_comm.get_last_message()
        assert response is not None
        assert response['type'] == 'OVERLAY_UNLOAD_RESPONSE'
        assert response['status'] == 'SUCCESS'
        assert response['unloaded'] is True
        assert response['result'] == 'SUCCESS'

        assert cache_manager.get_overlay_index(overlay_key) is None

    def test_overlay_unload_not_found(self, mock_comm):
        """Test unloading overlay that doesn't exist in cache"""
        cache_manager, logger = _make_cache_with_image()
        processor = OverlayUnloadProcessor(cache_manager, logger)

        processor.process({'imageName': 'test_image.tif', 'overlayName': 'nonexistent.geojson'}, mock_comm)

        response = mock_comm.get_last_message()
        assert response is not None
        assert response['type'] == 'OVERLAY_UNLOAD_RESPONSE'
        assert response['status'] == 'SUCCESS'
        assert response['unloaded'] is False
        assert response['result'] == 'NOT_FOUND'


class TestModelProcessorStubs:
    """Verify model processor stubs are registered and raise NotImplementedError"""

    def test_stubs_registered(self):
        """EndpointListProcessor and ModelTileProcessor must be in the registry"""
        cache_manager = AdvancedCacheManager()
        logger = OSMLKernelLogger()
        registry = _build_registry(cache_manager, logger)
        registered = registry.get_registered_message_types()

        assert 'LIST_AVAILABLE_ENDPOINTS' in registered
        assert 'MODEL_TILE_REQUEST' in registered

    def test_endpoint_list_stub_raises(self, mock_comm):
        """EndpointListProcessor.process raises NotImplementedError"""
        cache_manager = AdvancedCacheManager()
        logger = OSMLKernelLogger()
        processor = EndpointListProcessor(cache_manager, logger)

        processor.process({}, mock_comm)

        response = mock_comm.get_last_message()
        assert response is not None
        assert response['status'] == 'ERROR'

    def test_model_tile_stub_raises(self, mock_comm):
        """ModelTileProcessor.process raises NotImplementedError"""
        cache_manager = AdvancedCacheManager()
        logger = OSMLKernelLogger()
        processor = ModelTileProcessor(cache_manager, logger)

        processor.process({'dataset': 'x.tif', 'endpointName': 'ep', 'zoom': 0, 'row': 0, 'col': 0}, mock_comm)

        response = mock_comm.get_last_message()
        assert response is not None
        assert response['status'] == 'ERROR'


class TestMLMessageIntegration:
    """Integration tests for ML and overlay message types"""

    def test_all_overlay_processors_registered(self):
        """Overlay and model message types must appear in the registry"""
        cache_manager = AdvancedCacheManager()
        logger = OSMLKernelLogger()
        registry = _build_registry(cache_manager, logger)
        registered = registry.get_registered_message_types()

        for msg_type in ['OVERLAY_LOAD_REQUEST', 'OVERLAY_UNLOAD_REQUEST',
                         'LIST_AVAILABLE_ENDPOINTS', 'MODEL_TILE_REQUEST']:
            assert msg_type in registered, f"Message type {msg_type} not registered"

    def test_complete_overlay_lifecycle(self, mock_comm, sample_overlay_data, tmp_path):
        """Test complete overlay load -> tile -> unload lifecycle via registry"""
        overlay_file = tmp_path / "lifecycle_test.geojson"
        overlay_file.write_text(json.dumps(sample_overlay_data))

        image_name = 'test_image.tif'
        cache_manager, logger = _make_cache_with_image(image_name)
        registry = _build_registry(cache_manager, logger)

        registry.handle(
            'OVERLAY_LOAD_REQUEST',
            {'type': 'OVERLAY_LOAD_REQUEST', 'imageName': image_name, 'overlayName': str(overlay_file)},
            mock_comm,
        )
        load_response = mock_comm.get_last_message()
        assert load_response['status'] == 'SUCCESS'

        mock_comm.clear_messages()

        registry.handle(
            'OVERLAY_TILE_REQUEST',
            {'type': 'OVERLAY_TILE_REQUEST', 'imageName': image_name, 'overlayName': str(overlay_file),
             'zoom': 0, 'row': 0, 'col': 0},
            mock_comm,
        )
        tile_response = mock_comm.get_last_message()
        assert tile_response['status'] == 'SUCCESS'

        mock_comm.clear_messages()

        registry.handle(
            'OVERLAY_UNLOAD_REQUEST',
            {'type': 'OVERLAY_UNLOAD_REQUEST', 'imageName': image_name, 'overlayName': str(overlay_file)},
            mock_comm,
        )
        unload_response = mock_comm.get_last_message()
        assert unload_response['status'] == 'SUCCESS'
        assert unload_response['unloaded'] is True
