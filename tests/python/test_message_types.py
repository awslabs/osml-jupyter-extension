"""
Test suite for image metadata and lifecycle message types:
IMAGE_METADATA_REQUEST, IMAGE_STATISTICS_REQUEST, IMAGE_UNLOAD_REQUEST
"""

import pytest
from pathlib import Path
from fixtures.mock_comm import MockComm

from aws.osml.jupyter.cache import AdvancedCacheManager
from aws.osml.jupyter.core import OSMLKernelLogger
from aws.osml.jupyter.main import _build_registry


@pytest.fixture
def sample_tiff_file():
    return Path("tests/python/fixtures/sample_1band_512x512.tiff")


@pytest.fixture
def kernel_namespace():
    """Fixture providing a registry and cache_manager wired together."""
    cache_manager = AdvancedCacheManager()
    logger = OSMLKernelLogger()
    registry = _build_registry(cache_manager, logger)
    return {
        'global_message_registry': registry,
        'global_cache_manager': cache_manager,
        'get_registered_message_types': registry.get_registered_message_types,
    }


@pytest.fixture
def mock_comm():
    return MockComm()


class TestImageMetadataProcessor:
    """Test IMAGE_METADATA_REQUEST message handling"""

    def test_metadata_request_success(self, kernel_namespace, mock_comm, sample_tiff_file):
        """Test successful metadata extraction"""
        registry = kernel_namespace['global_message_registry']

        load_message = {'type': 'IMAGE_LOAD_REQUEST', 'dataset': str(sample_tiff_file)}
        registry.handle('IMAGE_LOAD_REQUEST', load_message, mock_comm)

        mock_comm.clear_messages()

        metadata_message = {'type': 'IMAGE_METADATA_REQUEST', 'dataset': str(sample_tiff_file)}
        registry.handle('IMAGE_METADATA_REQUEST', metadata_message, mock_comm)

        response = mock_comm.get_last_message()
        assert response is not None
        assert response['type'] == 'IMAGE_METADATA_RESPONSE'
        assert response['status'] == 'SUCCESS'
        assert 'dataset' in response
        assert 'metadata' in response
        assert isinstance(response['metadata'], dict)

    def test_metadata_request_image_not_loaded(self, kernel_namespace, mock_comm):
        """Test metadata request for non-loaded image"""
        registry = kernel_namespace['global_message_registry']

        metadata_message = {'type': 'IMAGE_METADATA_REQUEST', 'dataset': '/nonexistent/image.tiff'}
        registry.handle('IMAGE_METADATA_REQUEST', metadata_message, mock_comm)

        response = mock_comm.get_last_message()
        assert response is not None
        assert response['type'] == 'IMAGE_METADATA_RESPONSE'
        assert response['status'] == 'ERROR'
        assert 'error' in response

    def test_metadata_request_missing_dataset(self, kernel_namespace, mock_comm):
        """Test metadata request with missing dataset parameter"""
        registry = kernel_namespace['global_message_registry']

        metadata_message = {'type': 'IMAGE_METADATA_REQUEST'}
        registry.handle('IMAGE_METADATA_REQUEST', metadata_message, mock_comm)

        response = mock_comm.get_last_message()
        assert response is not None
        assert response['type'] == 'IMAGE_METADATA_RESPONSE'
        assert response['status'] == 'ERROR'
        assert 'Missing required fields' in response['error']

    def test_metadata_caching(self, kernel_namespace, mock_comm, sample_tiff_file):
        """Test that metadata is cached after first request"""
        registry = kernel_namespace['global_message_registry']
        cache_manager = kernel_namespace['global_cache_manager']

        load_message = {'type': 'IMAGE_LOAD_REQUEST', 'dataset': str(sample_tiff_file)}
        registry.handle('IMAGE_LOAD_REQUEST', load_message, mock_comm)

        metadata_message = {'type': 'IMAGE_METADATA_REQUEST', 'dataset': str(sample_tiff_file)}
        registry.handle('IMAGE_METADATA_REQUEST', metadata_message, mock_comm)
        registry.handle('IMAGE_METADATA_REQUEST', metadata_message, mock_comm)

        assert str(sample_tiff_file) in cache_manager.metadata_cache

        assert all(
            msg['status'] == 'SUCCESS'
            for msg in mock_comm.sent_messages
            if msg.get('type') == 'IMAGE_METADATA_RESPONSE'
        )


class TestImageStatisticsProcessor:
    """Test IMAGE_STATISTICS_REQUEST message handling"""

    def test_statistics_request_basic(self, kernel_namespace, mock_comm, sample_tiff_file):
        """Test basic statistics extraction"""
        registry = kernel_namespace['global_message_registry']

        load_message = {'type': 'IMAGE_LOAD_REQUEST', 'dataset': str(sample_tiff_file)}
        registry.handle('IMAGE_LOAD_REQUEST', load_message, mock_comm)
        mock_comm.clear_messages()

        stats_message = {'type': 'IMAGE_STATISTICS_REQUEST', 'dataset': str(sample_tiff_file)}
        registry.handle('IMAGE_STATISTICS_REQUEST', stats_message, mock_comm)

        response = mock_comm.get_last_message()
        assert response is not None
        assert response['type'] == 'IMAGE_STATISTICS_RESPONSE'
        assert response['status'] == 'SUCCESS'
        assert 'dataset' in response
        assert 'statistics' in response

        statistics = response['statistics']
        assert 'band_count' in statistics
        assert 'bands' in statistics
        assert statistics['band_count'] == 1
        assert len(statistics['bands']) == 1

        band_stats = statistics['bands'][0]
        assert band_stats['band_number'] == 1
        assert 'min' in band_stats
        assert 'max' in band_stats
        assert 'mean' in band_stats

    def test_statistics_request_with_histogram(self, kernel_namespace, mock_comm, sample_tiff_file):
        """Test statistics request with histogram computation"""
        registry = kernel_namespace['global_message_registry']

        load_message = {'type': 'IMAGE_LOAD_REQUEST', 'dataset': str(sample_tiff_file)}
        registry.handle('IMAGE_LOAD_REQUEST', load_message, mock_comm)
        mock_comm.clear_messages()

        stats_message = {
            'type': 'IMAGE_STATISTICS_REQUEST',
            'dataset': str(sample_tiff_file),
            'compute_histogram': True,
            'histogram_bins': 128,
        }
        registry.handle('IMAGE_STATISTICS_REQUEST', stats_message, mock_comm)

        response = mock_comm.get_last_message()
        assert response is not None
        assert response['type'] == 'IMAGE_STATISTICS_RESPONSE'
        assert response['status'] == 'SUCCESS'

        band_stats = response['statistics']['bands'][0]
        has_histogram = 'histogram' in band_stats
        has_histogram_error = 'histogram_error' in band_stats
        assert has_histogram or has_histogram_error

        if has_histogram:
            histogram = band_stats['histogram']
            assert histogram['bins'] == 128
            assert 'counts' in histogram
            assert len(histogram['counts']) == 128

    def test_statistics_caching(self, kernel_namespace, mock_comm, sample_tiff_file):
        """Test that statistics are cached"""
        registry = kernel_namespace['global_message_registry']
        cache_manager = kernel_namespace['global_cache_manager']

        load_message = {'type': 'IMAGE_LOAD_REQUEST', 'dataset': str(sample_tiff_file)}
        registry.handle('IMAGE_LOAD_REQUEST', load_message, mock_comm)

        registry.handle(
            'IMAGE_STATISTICS_REQUEST',
            {'type': 'IMAGE_STATISTICS_REQUEST', 'dataset': str(sample_tiff_file), 'compute_histogram': False},
            mock_comm,
        )
        registry.handle(
            'IMAGE_STATISTICS_REQUEST',
            {
                'type': 'IMAGE_STATISTICS_REQUEST',
                'dataset': str(sample_tiff_file),
                'compute_histogram': True,
                'histogram_bins': 256,
            },
            mock_comm,
        )

        assert len(cache_manager.statistics_cache) > 0

    def test_statistics_request_image_not_loaded(self, kernel_namespace, mock_comm):
        """Test statistics request for non-loaded image"""
        registry = kernel_namespace['global_message_registry']

        stats_message = {'type': 'IMAGE_STATISTICS_REQUEST', 'dataset': '/nonexistent/image.tiff'}
        registry.handle('IMAGE_STATISTICS_REQUEST', stats_message, mock_comm)

        response = mock_comm.get_last_message()
        assert response is not None
        assert response['type'] == 'IMAGE_STATISTICS_RESPONSE'
        assert response['status'] == 'ERROR'
        assert 'error' in response


class TestImageUnloadProcessor:
    """Test IMAGE_UNLOAD_REQUEST message handling"""

    def test_unload_request_success(self, kernel_namespace, mock_comm, sample_tiff_file):
        """Test successful image unloading"""
        registry = kernel_namespace['global_message_registry']
        cache_manager = kernel_namespace['global_cache_manager']

        load_message = {'type': 'IMAGE_LOAD_REQUEST', 'dataset': str(sample_tiff_file)}
        registry.handle('IMAGE_LOAD_REQUEST', load_message, mock_comm)

        assert str(sample_tiff_file) in cache_manager.image_sessions
        mock_comm.clear_messages()

        unload_message = {'type': 'IMAGE_UNLOAD_REQUEST', 'dataset': str(sample_tiff_file)}
        registry.handle('IMAGE_UNLOAD_REQUEST', unload_message, mock_comm)

        response = mock_comm.get_last_message()
        assert response is not None
        assert response['type'] == 'IMAGE_UNLOAD_RESPONSE'
        assert response['status'] == 'SUCCESS'
        assert response['result'] == 'SUCCESS'
        assert response['dataset'] == str(sample_tiff_file)
        assert response['unloaded'] is True

        assert str(sample_tiff_file) not in cache_manager.image_sessions

    def test_unload_request_not_found(self, kernel_namespace, mock_comm):
        """Test unloading non-existent image"""
        registry = kernel_namespace['global_message_registry']

        unload_message = {'type': 'IMAGE_UNLOAD_REQUEST', 'dataset': '/nonexistent/image.tiff'}
        registry.handle('IMAGE_UNLOAD_REQUEST', unload_message, mock_comm)

        response = mock_comm.get_last_message()
        assert response is not None
        assert response['type'] == 'IMAGE_UNLOAD_RESPONSE'
        assert response['status'] == 'SUCCESS'
        assert response['result'] == 'NOT_FOUND'
        assert response['unloaded'] is False

    def test_unload_clears_related_caches(self, kernel_namespace, mock_comm, sample_tiff_file):
        """Test that unloading clears metadata and statistics caches"""
        registry = kernel_namespace['global_message_registry']
        cache_manager = kernel_namespace['global_cache_manager']

        registry.handle('IMAGE_LOAD_REQUEST', {'type': 'IMAGE_LOAD_REQUEST', 'dataset': str(sample_tiff_file)}, mock_comm)
        registry.handle('IMAGE_METADATA_REQUEST', {'type': 'IMAGE_METADATA_REQUEST', 'dataset': str(sample_tiff_file)}, mock_comm)
        registry.handle('IMAGE_STATISTICS_REQUEST', {'type': 'IMAGE_STATISTICS_REQUEST', 'dataset': str(sample_tiff_file)}, mock_comm)

        assert str(sample_tiff_file) in cache_manager.metadata_cache
        assert len(cache_manager.statistics_cache) > 0

        registry.handle('IMAGE_UNLOAD_REQUEST', {'type': 'IMAGE_UNLOAD_REQUEST', 'dataset': str(sample_tiff_file)}, mock_comm)

        assert str(sample_tiff_file) not in cache_manager.metadata_cache

        remaining_stats_keys = [k for k in cache_manager.statistics_cache if k.startswith(f"{sample_tiff_file}:")]
        assert len(remaining_stats_keys) == 0

    def test_unload_request_missing_dataset(self, kernel_namespace, mock_comm):
        """Test unload request with missing dataset parameter"""
        registry = kernel_namespace['global_message_registry']

        registry.handle('IMAGE_UNLOAD_REQUEST', {'type': 'IMAGE_UNLOAD_REQUEST'}, mock_comm)

        response = mock_comm.get_last_message()
        assert response is not None
        assert response['type'] == 'IMAGE_UNLOAD_RESPONSE'
        assert response['status'] == 'ERROR'
        assert 'Missing required fields' in response['error']


class TestImageMessageIntegration:
    """Integration tests for image metadata and lifecycle message types"""

    def test_complete_lifecycle(self, kernel_namespace, mock_comm, sample_tiff_file):
        """Test complete lifecycle: load -> metadata -> statistics -> unload"""
        registry = kernel_namespace['global_message_registry']
        cache_manager = kernel_namespace['global_cache_manager']

        registry.handle('IMAGE_LOAD_REQUEST', {'type': 'IMAGE_LOAD_REQUEST', 'dataset': str(sample_tiff_file)}, mock_comm)
        load_response = mock_comm.get_last_message()
        assert load_response['status'] == 'SUCCESS'

        registry.handle('IMAGE_METADATA_REQUEST', {'type': 'IMAGE_METADATA_REQUEST', 'dataset': str(sample_tiff_file)}, mock_comm)
        metadata_response = next((m for m in reversed(mock_comm.sent_messages) if m.get('type') == 'IMAGE_METADATA_RESPONSE'), None)
        assert metadata_response is not None
        assert metadata_response['status'] == 'SUCCESS'

        registry.handle(
            'IMAGE_STATISTICS_REQUEST',
            {'type': 'IMAGE_STATISTICS_REQUEST', 'dataset': str(sample_tiff_file), 'compute_histogram': True},
            mock_comm,
        )
        stats_response = next((m for m in reversed(mock_comm.sent_messages) if m.get('type') == 'IMAGE_STATISTICS_RESPONSE'), None)
        assert stats_response is not None
        assert stats_response['status'] == 'SUCCESS'

        assert str(sample_tiff_file) in cache_manager.image_sessions
        assert str(sample_tiff_file) in cache_manager.metadata_cache
        assert len(cache_manager.statistics_cache) > 0

        registry.handle('IMAGE_UNLOAD_REQUEST', {'type': 'IMAGE_UNLOAD_REQUEST', 'dataset': str(sample_tiff_file)}, mock_comm)
        unload_response = next((m for m in reversed(mock_comm.sent_messages) if m.get('type') == 'IMAGE_UNLOAD_RESPONSE'), None)
        assert unload_response is not None
        assert unload_response['status'] == 'SUCCESS'
        assert unload_response['unloaded'] is True

        assert str(sample_tiff_file) not in cache_manager.image_sessions
        assert str(sample_tiff_file) not in cache_manager.metadata_cache
        remaining_stats = [k for k in cache_manager.statistics_cache if k.startswith(f"{sample_tiff_file}:")]
        assert len(remaining_stats) == 0

    def test_registered_message_types(self, kernel_namespace):
        """Test that all image metadata and lifecycle message types are registered"""
        get_registered_types = kernel_namespace['get_registered_message_types']
        registered_types = get_registered_types()

        for msg_type in ['IMAGE_METADATA_REQUEST', 'IMAGE_STATISTICS_REQUEST', 'IMAGE_UNLOAD_REQUEST',
                         'IMAGE_LOAD_REQUEST', 'IMAGE_TILE_REQUEST', 'OVERLAY_TILE_REQUEST']:
            assert msg_type in registered_types, f"Message type {msg_type} not registered"
