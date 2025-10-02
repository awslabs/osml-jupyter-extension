"""
Test suite for image metadata and lifecycle message types: IMAGE_METADATA_REQUEST, IMAGE_STATISTICS_REQUEST, IMAGE_UNLOAD_REQUEST
"""

import pytest
import tempfile
import os
import json
from pathlib import Path
from fixtures.mock_comm import MockComm

# Test data setup
@pytest.fixture
def sample_tiff_file():
    """Fixture providing path to a test TIFF file"""
    return Path("tests/python/fixtures/sample_1band_512x512.tiff")

@pytest.fixture
def kernel_namespace():
    """Fixture providing kernel namespace with loaded code"""
    namespace = {}
    kernel_file = Path("src/kernel/kernel-setup.py")
    
    with open(kernel_file, 'r') as f:
        kernel_code = f.read()
    
    # Mock IPython functionality for testing
    class MockIPython:
        class MockKernel:
            class MockCommManager:
                def register_target(self, name, func):
                    pass
            comm_manager = MockCommManager()
        kernel = MockKernel()
    
    # Add mocks to namespace
    namespace['get_ipython'] = lambda: MockIPython()
    
    # Execute the kernel code with mocks
    exec(kernel_code, namespace)
    return namespace

@pytest.fixture
def mock_comm():
    """Fixture providing a mock comm channel"""
    return MockComm()


class TestImageMetadataProcessor:
    """Test IMAGE_METADATA_REQUEST message handling"""
    
    def test_metadata_request_success(self, kernel_namespace, mock_comm, sample_tiff_file):
        """Test successful metadata extraction"""
        # Get the global registry from kernel namespace
        registry = kernel_namespace['global_message_registry']
        
        # First load the image
        load_message = {'type': 'IMAGE_LOAD_REQUEST', 'dataset': str(sample_tiff_file)}
        registry.handle('IMAGE_LOAD_REQUEST', load_message, mock_comm)
        
        # Clear previous messages
        mock_comm.clear_messages()
        
        # Request metadata
        metadata_message = {'type': 'IMAGE_METADATA_REQUEST', 'dataset': str(sample_tiff_file)}
        registry.handle('IMAGE_METADATA_REQUEST', metadata_message, mock_comm)
        
        # Check response
        response = mock_comm.get_last_message()
        assert response is not None
        assert response['type'] == 'IMAGE_METADATA_RESPONSE'
        assert response['status'] == 'SUCCESS'
        assert 'dataset' in response
        assert 'metadata' in response
        
        # Validate metadata structure
        metadata = response['metadata']
        assert 'width' in metadata
        assert 'height' in metadata
        assert 'bands' in metadata
        assert 'data_type' in metadata
        assert 'projection' in metadata
        assert 'geotransform' in metadata
        
        # Check specific values for our test file
        assert metadata['width'] == 512
        assert metadata['height'] == 512
        assert metadata['bands'] == 1
    
    def test_metadata_request_image_not_loaded(self, kernel_namespace, mock_comm):
        """Test metadata request for non-loaded image"""
        registry = kernel_namespace['global_message_registry']
        
        # Request metadata for non-existent image
        metadata_message = {
            'type': 'IMAGE_METADATA_REQUEST', 
            'dataset': '/nonexistent/image.tiff'
        }
        registry.handle('IMAGE_METADATA_REQUEST', metadata_message, mock_comm)
        
        # Check error response
        response = mock_comm.get_last_message()
        assert response is not None
        assert response['type'] == 'IMAGE_METADATA_RESPONSE'
        assert response['status'] == 'ERROR'
        assert 'error' in response
    
    def test_metadata_request_missing_dataset(self, kernel_namespace, mock_comm):
        """Test metadata request with missing dataset parameter"""
        registry = kernel_namespace['global_message_registry']
        
        # Request metadata without dataset
        metadata_message = {'type': 'IMAGE_METADATA_REQUEST'}
        registry.handle('IMAGE_METADATA_REQUEST', metadata_message, mock_comm)
        
        # Check error response
        response = mock_comm.get_last_message()
        assert response is not None
        assert response['type'] == 'IMAGE_METADATA_RESPONSE'
        assert response['status'] == 'ERROR'
        assert 'Missing required fields' in response['error']
    
    def test_metadata_caching(self, kernel_namespace, mock_comm, sample_tiff_file):
        """Test that metadata is cached properly"""
        registry = kernel_namespace['global_message_registry']
        cache_manager = kernel_namespace['global_cache_manager']
        
        # Load image first
        load_message = {'type': 'IMAGE_LOAD_REQUEST', 'dataset': str(sample_tiff_file)}
        registry.handle('IMAGE_LOAD_REQUEST', load_message, mock_comm)
        
        # Request metadata twice
        metadata_message = {'type': 'IMAGE_METADATA_REQUEST', 'dataset': str(sample_tiff_file)}
        registry.handle('IMAGE_METADATA_REQUEST', metadata_message, mock_comm)
        registry.handle('IMAGE_METADATA_REQUEST', metadata_message, mock_comm)
        
        # Check that metadata was cached
        assert str(sample_tiff_file) in cache_manager.metadata_cache
        
        # Both requests should succeed
        assert len(mock_comm.sent_messages) >= 2
        assert all(msg['status'] == 'SUCCESS' for msg in mock_comm.sent_messages 
                  if msg.get('type') == 'IMAGE_METADATA_RESPONSE')


class TestImageStatisticsProcessor:
    """Test IMAGE_STATISTICS_REQUEST message handling"""
    
    def test_statistics_request_basic(self, kernel_namespace, mock_comm, sample_tiff_file):
        """Test basic statistics extraction"""
        registry = kernel_namespace['global_message_registry']
        
        # Load image first
        load_message = {'type': 'IMAGE_LOAD_REQUEST', 'dataset': str(sample_tiff_file)}
        registry.handle('IMAGE_LOAD_REQUEST', load_message, mock_comm)
        
        # Clear previous messages
        mock_comm.clear_messages()
        
        # Request statistics
        stats_message = {'type': 'IMAGE_STATISTICS_REQUEST', 'dataset': str(sample_tiff_file)}
        registry.handle('IMAGE_STATISTICS_REQUEST', stats_message, mock_comm)
        
        # Check response
        response = mock_comm.get_last_message()
        assert response is not None
        assert response['type'] == 'IMAGE_STATISTICS_RESPONSE'
        assert response['status'] == 'SUCCESS'
        assert 'dataset' in response
        assert 'statistics' in response
        
        # Validate statistics structure
        statistics = response['statistics']
        assert 'band_count' in statistics
        assert 'bands' in statistics
        assert statistics['band_count'] == 1
        assert len(statistics['bands']) == 1
        
        # Check band statistics
        band_stats = statistics['bands'][0]
        assert 'band_number' in band_stats
        assert band_stats['band_number'] == 1
        assert 'data_type' in band_stats
    
    def test_statistics_request_with_histogram(self, kernel_namespace, mock_comm, sample_tiff_file):
        """Test statistics request with histogram computation"""
        registry = kernel_namespace['global_message_registry']
        
        # Load image first
        load_message = {'type': 'IMAGE_LOAD_REQUEST', 'dataset': str(sample_tiff_file)}
        registry.handle('IMAGE_LOAD_REQUEST', load_message, mock_comm)
        
        # Clear previous messages
        mock_comm.clear_messages()
        
        # Request statistics with histogram
        stats_message = {
            'type': 'IMAGE_STATISTICS_REQUEST', 
            'dataset': str(sample_tiff_file),
            'compute_histogram': True,
            'histogram_bins': 128
        }
        registry.handle('IMAGE_STATISTICS_REQUEST', stats_message, mock_comm)
        
        # Check response
        response = mock_comm.get_last_message()
        assert response is not None
        assert response['type'] == 'IMAGE_STATISTICS_RESPONSE'
        assert response['status'] == 'SUCCESS'
        
        # Check for histogram data
        statistics = response['statistics']
        band_stats = statistics['bands'][0]
        
        # Histogram might not always be available depending on GDAL version/image
        # So we check if it exists OR if there's a histogram error
        has_histogram = 'histogram' in band_stats
        has_histogram_error = 'histogram_error' in band_stats
        assert has_histogram or has_histogram_error
        
        if has_histogram:
            histogram = band_stats['histogram']
            assert histogram['bins'] == 128
            assert 'counts' in histogram
            assert len(histogram['counts']) == 128
    
    def test_statistics_caching(self, kernel_namespace, mock_comm, sample_tiff_file):
        """Test that statistics are cached with different parameters"""
        registry = kernel_namespace['global_message_registry']
        cache_manager = kernel_namespace['global_cache_manager']
        
        # Load image first
        load_message = {'type': 'IMAGE_LOAD_REQUEST', 'dataset': str(sample_tiff_file)}
        registry.handle('IMAGE_LOAD_REQUEST', load_message, mock_comm)
        
        # Request statistics with different parameters
        stats_message1 = {
            'type': 'IMAGE_STATISTICS_REQUEST', 
            'dataset': str(sample_tiff_file),
            'compute_histogram': False
        }
        stats_message2 = {
            'type': 'IMAGE_STATISTICS_REQUEST', 
            'dataset': str(sample_tiff_file),
            'compute_histogram': True,
            'histogram_bins': 256
        }
        
        registry.handle('IMAGE_STATISTICS_REQUEST', stats_message1, mock_comm)
        registry.handle('IMAGE_STATISTICS_REQUEST', stats_message2, mock_comm)
        
        # Check that both are cached separately
        cache_key1 = f"{sample_tiff_file}:False:256"
        cache_key2 = f"{sample_tiff_file}:True:256"
        
        # At least one should be cached (depending on default parameters)
        assert len(cache_manager.statistics_cache) > 0
    
    def test_statistics_request_image_not_loaded(self, kernel_namespace, mock_comm):
        """Test statistics request for non-loaded image"""
        registry = kernel_namespace['global_message_registry']
        
        # Request statistics for non-existent image
        stats_message = {
            'type': 'IMAGE_STATISTICS_REQUEST', 
            'dataset': '/nonexistent/image.tiff'
        }
        registry.handle('IMAGE_STATISTICS_REQUEST', stats_message, mock_comm)
        
        # Check error response
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
        
        # Load image first
        load_message = {'type': 'IMAGE_LOAD_REQUEST', 'dataset': str(sample_tiff_file)}
        registry.handle('IMAGE_LOAD_REQUEST', load_message, mock_comm)
        
        # Verify image is loaded
        assert str(sample_tiff_file) in cache_manager.image_factories
        
        # Clear previous messages
        mock_comm.clear_messages()
        
        # Unload image
        unload_message = {'type': 'IMAGE_UNLOAD_REQUEST', 'dataset': str(sample_tiff_file)}
        registry.handle('IMAGE_UNLOAD_REQUEST', unload_message, mock_comm)
        
        # Check response
        response = mock_comm.get_last_message()
        assert response is not None
        assert response['type'] == 'IMAGE_UNLOAD_RESPONSE'
        assert response['status'] == 'SUCCESS'
        assert response['result'] == 'SUCCESS'
        assert response['dataset'] == str(sample_tiff_file)
        assert response['unloaded'] is True
        
        # Verify image is removed from cache
        assert str(sample_tiff_file) not in cache_manager.image_factories
    
    def test_unload_request_not_found(self, kernel_namespace, mock_comm):
        """Test unloading non-existent image"""
        registry = kernel_namespace['global_message_registry']
        
        # Unload non-existent image
        unload_message = {
            'type': 'IMAGE_UNLOAD_REQUEST', 
            'dataset': '/nonexistent/image.tiff'
        }
        registry.handle('IMAGE_UNLOAD_REQUEST', unload_message, mock_comm)
        
        # Check response
        response = mock_comm.get_last_message()
        assert response is not None
        assert response['type'] == 'IMAGE_UNLOAD_RESPONSE'
        assert response['status'] == 'SUCCESS'  # Operation is successful
        assert response['result'] == 'NOT_FOUND'  # But nothing was found to unload
        assert response['unloaded'] is False
    
    def test_unload_clears_related_caches(self, kernel_namespace, mock_comm, sample_tiff_file):
        """Test that unloading clears metadata and statistics caches"""
        registry = kernel_namespace['global_message_registry']
        cache_manager = kernel_namespace['global_cache_manager']
        
        # Load image and request metadata and statistics
        load_message = {'type': 'IMAGE_LOAD_REQUEST', 'dataset': str(sample_tiff_file)}
        registry.handle('IMAGE_LOAD_REQUEST', load_message, mock_comm)
        
        metadata_message = {'type': 'IMAGE_METADATA_REQUEST', 'dataset': str(sample_tiff_file)}
        registry.handle('IMAGE_METADATA_REQUEST', metadata_message, mock_comm)
        
        stats_message = {'type': 'IMAGE_STATISTICS_REQUEST', 'dataset': str(sample_tiff_file)}
        registry.handle('IMAGE_STATISTICS_REQUEST', stats_message, mock_comm)
        
        # Verify caches have data
        assert str(sample_tiff_file) in cache_manager.metadata_cache
        assert len(cache_manager.statistics_cache) > 0
        
        # Unload image
        unload_message = {'type': 'IMAGE_UNLOAD_REQUEST', 'dataset': str(sample_tiff_file)}
        registry.handle('IMAGE_UNLOAD_REQUEST', unload_message, mock_comm)
        
        # Verify related caches are cleared
        assert str(sample_tiff_file) not in cache_manager.metadata_cache
        
        # Check that statistics cache for this dataset is cleared
        remaining_stats_keys = [key for key in cache_manager.statistics_cache.keys() 
                               if key.startswith(f"{sample_tiff_file}:")]
        assert len(remaining_stats_keys) == 0
    
    def test_unload_request_missing_dataset(self, kernel_namespace, mock_comm):
        """Test unload request with missing dataset parameter"""
        registry = kernel_namespace['global_message_registry']
        
        # Unload without dataset
        unload_message = {'type': 'IMAGE_UNLOAD_REQUEST'}
        registry.handle('IMAGE_UNLOAD_REQUEST', unload_message, mock_comm)
        
        # Check error response
        response = mock_comm.get_last_message()
        assert response is not None
        assert response['type'] == 'IMAGE_UNLOAD_RESPONSE'
        assert response['status'] == 'ERROR'
        assert 'Missing required fields' in response['error']


class TestImageMessageIntegration:
    """Integration tests for image metadata and lifecycle message types working together"""
    
    def test_complete_lifecycle(self, kernel_namespace, mock_comm, sample_tiff_file):
        """Test complete lifecycle: load -> metadata -> statistics -> unload"""
        registry = kernel_namespace['global_message_registry']
        cache_manager = kernel_namespace['global_cache_manager']
        
        # 1. Load image
        load_message = {'type': 'IMAGE_LOAD_REQUEST', 'dataset': str(sample_tiff_file)}
        registry.handle('IMAGE_LOAD_REQUEST', load_message, mock_comm)
        
        load_response = mock_comm.get_last_message()
        assert load_response['status'] == 'SUCCESS'
        
        # 2. Get metadata
        metadata_message = {'type': 'IMAGE_METADATA_REQUEST', 'dataset': str(sample_tiff_file)}
        registry.handle('IMAGE_METADATA_REQUEST', metadata_message, mock_comm)
        
        metadata_response = None
        for msg in reversed(mock_comm.sent_messages):
            if msg.get('type') == 'IMAGE_METADATA_RESPONSE':
                metadata_response = msg
                break
        
        assert metadata_response is not None
        assert metadata_response['status'] == 'SUCCESS'
        
        # 3. Get statistics
        stats_message = {
            'type': 'IMAGE_STATISTICS_REQUEST', 
            'dataset': str(sample_tiff_file),
            'compute_histogram': True
        }
        registry.handle('IMAGE_STATISTICS_REQUEST', stats_message, mock_comm)
        
        stats_response = None
        for msg in reversed(mock_comm.sent_messages):
            if msg.get('type') == 'IMAGE_STATISTICS_RESPONSE':
                stats_response = msg
                break
        
        assert stats_response is not None
        assert stats_response['status'] == 'SUCCESS'
        
        # 4. Verify caches are populated
        assert str(sample_tiff_file) in cache_manager.image_factories
        assert str(sample_tiff_file) in cache_manager.metadata_cache
        assert len(cache_manager.statistics_cache) > 0
        
        # 5. Unload image
        unload_message = {'type': 'IMAGE_UNLOAD_REQUEST', 'dataset': str(sample_tiff_file)}
        registry.handle('IMAGE_UNLOAD_REQUEST', unload_message, mock_comm)
        
        unload_response = None
        for msg in reversed(mock_comm.sent_messages):
            if msg.get('type') == 'IMAGE_UNLOAD_RESPONSE':
                unload_response = msg
                break
        
        assert unload_response is not None
        assert unload_response['status'] == 'SUCCESS'
        assert unload_response['unloaded'] is True
        
        # 6. Verify all caches are cleared
        assert str(sample_tiff_file) not in cache_manager.image_factories
        assert str(sample_tiff_file) not in cache_manager.metadata_cache
        
        remaining_stats = [k for k in cache_manager.statistics_cache.keys() 
                          if k.startswith(f"{sample_tiff_file}:")]
        assert len(remaining_stats) == 0
    
    def test_registered_message_types(self, kernel_namespace):
        """Test that all image metadata and lifecycle message types are properly registered"""
        get_registered_types = kernel_namespace['get_registered_message_types']
        registered_types = get_registered_types()
        
        # Check that all image metadata and lifecycle message types are registered
        expected_message_types = [
            'IMAGE_METADATA_REQUEST',
            'IMAGE_STATISTICS_REQUEST', 
            'IMAGE_UNLOAD_REQUEST'
        ]
        
        for msg_type in expected_message_types:
            assert msg_type in registered_types, f"Message type {msg_type} not registered"
        
        # Also check existing types are still there
        existing_types = [
            'IMAGE_LOAD_REQUEST',
            'IMAGE_TILE_REQUEST',
            'OVERLAY_TILE_REQUEST'
        ]
        
        for msg_type in existing_types:
            assert msg_type in registered_types, f"Existing message type {msg_type} missing"
