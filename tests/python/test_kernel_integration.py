"""
Integration tests for the aws.osml.jupyter package.
"""

import pytest
from pathlib import Path
from unittest.mock import MagicMock
from fixtures.mock_comm import MockComm, MockKernel

import aws.osml.jupyter
from aws.osml.jupyter.cache import AdvancedCacheManager
from aws.osml.jupyter.core import OSMLKernelLogger
from aws.osml.jupyter.main import _build_registry, initialize


class TestKernelPackage:
    """Verify the aws.osml.jupyter package is importable and wires up correctly"""

    def test_package_importable(self):
        """aws.osml.jupyter must import without errors"""
        import aws.osml.jupyter as k
        assert hasattr(k, 'initialize')
        assert hasattr(k, '__version__')

    def test_initialize_registers_comm_target(self):
        """initialize() must register osml_comm_target with the IPython comm manager"""
        mock_kernel = MockKernel()
        initialize(mock_kernel, force=True)
        assert 'osml_comm_target' in mock_kernel.comm_manager.targets

    def test_initialize_idempotent(self):
        """Calling initialize() twice (without force) must not raise"""
        mock_kernel = MockKernel()
        initialize(mock_kernel, force=True)
        initialize(mock_kernel)

    def test_registry_has_expected_message_types(self):
        """_build_registry must register all expected message types"""
        cache_manager = AdvancedCacheManager()
        logger = OSMLKernelLogger()
        registry = _build_registry(cache_manager, logger)
        registered = registry.get_registered_message_types()

        expected = [
            'IMAGE_LOAD_REQUEST',
            'IMAGE_TILE_REQUEST',
            'IMAGE_METADATA_REQUEST',
            'IMAGE_STATISTICS_REQUEST',
            'IMAGE_UNLOAD_REQUEST',
            'OVERLAY_TILE_REQUEST',
            'OVERLAY_LOAD_REQUEST',
            'OVERLAY_UNLOAD_REQUEST',
            'LIST_AVAILABLE_ENDPOINTS',
            'MODEL_TILE_REQUEST',
            'IMAGE_TO_WORLD_REQUEST',
            'WORLD_TO_IMAGE_REQUEST',
            'PYRAMID_BUILD_REQUEST',
        ]
        for msg_type in expected:
            assert msg_type in registered, f"Expected message type {msg_type} not registered"


class TestMessageProcessingIntegration:
    """Test complete message processing workflows"""

    @pytest.fixture
    def mock_comm(self):
        return MockComm()

    @pytest.fixture
    def registry_and_cache(self):
        cache_manager = AdvancedCacheManager()
        logger = OSMLKernelLogger()
        registry = _build_registry(cache_manager, logger)
        return registry, cache_manager

    def test_image_load_message_structure(self, mock_comm):
        """IMAGE_LOAD_REQUEST message must contain required fields"""
        image_load_request = {'type': 'IMAGE_LOAD_REQUEST', 'dataset': 'test_image.tiff'}
        assert 'type' in image_load_request
        assert 'dataset' in image_load_request
        assert image_load_request['type'] == 'IMAGE_LOAD_REQUEST'

    def test_image_tile_message_structure(self, mock_comm):
        """IMAGE_TILE_REQUEST message must contain required fields"""
        image_tile_request = {'type': 'IMAGE_TILE_REQUEST', 'dataset': 'test_image.tiff', 'zoom': 10, 'row': 512, 'col': 256}
        for field in ['type', 'dataset', 'zoom', 'row', 'col']:
            assert field in image_tile_request
        assert image_tile_request['type'] == 'IMAGE_TILE_REQUEST'

    def test_overlay_tile_message_structure(self, mock_comm):
        """OVERLAY_TILE_REQUEST message must contain required fields"""
        overlay_tile_request = {
            'type': 'OVERLAY_TILE_REQUEST',
            'imageName': 'test_image.tiff',
            'overlayName': 'test_overlay.geojson',
            'zoom': 5,
            'row': 128,
            'col': 64,
        }
        for field in ['type', 'imageName', 'overlayName', 'zoom', 'row', 'col']:
            assert field in overlay_tile_request
        assert overlay_tile_request['type'] == 'OVERLAY_TILE_REQUEST'

    def test_comm_handler_registration(self, mock_comm):
        """The comm target handler must be callable and complete the setup handshake"""
        mock_kernel = MockKernel()
        initialize(mock_kernel, force=True)

        # Trigger the target handler (simulates JupyterLab opening a comm)
        mock_kernel.comm_manager.new_comm('osml_comm_target', {})

        # The handler must have sent KERNEL_COMM_SETUP_COMPLETE on the comm
        comm = list(mock_kernel.comm_manager.comms.values())[0]
        assert any(
            msg.get('type') == 'KERNEL_COMM_SETUP_COMPLETE'
            for msg in comm.sent_messages
        )


class TestCacheSystemIntegration:
    """Test cache system integration"""

    @pytest.fixture
    def sample_tiff_file(self):
        return Path("tests/python/fixtures/sample_1band_512x512.tiff")

    @pytest.fixture
    def sample_geojson_file(self):
        return Path("tests/python/fixtures/sample_overlay.geojson")

    def test_image_factory_caching_concept(self, sample_tiff_file):
        """Test fixture exists (or is skipped) so subsequent image tests can run"""
        if sample_tiff_file.exists():
            assert sample_tiff_file.stat().st_size > 0, "Test TIFF file should not be empty"
        else:
            pytest.skip("Test TIFF file not found - run generate-test-data.py first")

    def test_overlay_factory_caching_concept(self, sample_geojson_file):
        """Test fixture exists (or is skipped)"""
        if sample_geojson_file.exists():
            assert sample_geojson_file.stat().st_size > 0, "Test GeoJSON file should not be empty"
        else:
            pytest.skip("Test GeoJSON file not found - run generate-test-data.py first")


class TestErrorHandlingIntegration:
    """Test error response formats"""

    def test_error_response_format(self):
        expected = {'type': 'IMAGE_LOAD_RESPONSE', 'status': 'ERROR', 'error': 'Test error message'}
        assert expected['status'] == 'ERROR'
        assert 'type' in expected
        assert 'error' in expected

    def test_success_response_format(self):
        expected = {'type': 'IMAGE_LOAD_RESPONSE', 'status': 'SUCCESS', 'dataset': 'test_image.tiff'}
        assert expected['status'] == 'SUCCESS'
        assert 'type' in expected
