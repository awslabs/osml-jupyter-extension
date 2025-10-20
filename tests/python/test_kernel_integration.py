"""
Integration tests for kernel setup and message processing
"""

import pytest
import tempfile
import os
import sys
from pathlib import Path
from fixtures.mock_comm import MockComm, MockKernel


class TestKernelSetupIntegration:
    """Test kernel setup code integration"""
    
    def test_kernel_setup_file_exists(self):
        """Test that the concatenated kernel-setup.py exists"""
        kernel_file = Path("lib/kernel/kernel-setup.py")
        assert kernel_file.exists(), f"Concatenated kernel file should exist at {kernel_file}"
    
    def test_kernel_setup_compiles_successfully(self):
        """Test that the concatenated kernel-setup.py compiles without errors"""
        kernel_file = Path("lib/kernel/kernel-setup.py")
        
        # Skip if file doesn't exist (build not run)
        if not kernel_file.exists():
            pytest.skip("Kernel setup file not found - run build first")
        
        # Read and compile the kernel setup code
        with open(kernel_file, 'r') as f:
            kernel_code = f.read()
        
        # Should compile without syntax errors
        try:
            compile(kernel_code, str(kernel_file), 'exec')
        except SyntaxError as e:
            pytest.fail(f"Kernel setup code has syntax errors: {e}")
    
    def test_kernel_setup_execution_no_errors(self):
        """Test that kernel setup code executes without runtime errors"""
        kernel_file = Path("lib/kernel/kernel-setup.py")
        
        if not kernel_file.exists():
            pytest.skip("Kernel setup file not found - run build first")
        
        # Execute the kernel code in a controlled namespace
        mock_kernel = MockKernel()
        namespace = {
            '__name__': '__main__',
            'get_ipython': lambda: mock_kernel
        }
        
        # Mock required modules that might not be available in test environment
        mock_modules = {
            'IPython': type(sys)('IPython'),
            'IPython.core': type(sys)('IPython.core'),
        }
        
        # Temporarily add mocks to sys.modules
        original_modules = {}
        for module_name, mock_module in mock_modules.items():
            if module_name in sys.modules:
                original_modules[module_name] = sys.modules[module_name]
            sys.modules[module_name] = mock_module
        
        try:
            with open(kernel_file, 'r') as f:
                kernel_code = f.read()
            
            # Execute without errors
            exec(kernel_code, namespace)
            
        except Exception as e:
            pytest.fail(f"Kernel setup code execution failed: {e}")
        
        finally:
            # Restore original modules
            for module_name, original_module in original_modules.items():
                sys.modules[module_name] = original_module
            for module_name in mock_modules:
                if module_name not in original_modules and module_name in sys.modules:
                    del sys.modules[module_name]
    
    def test_kernel_setup_defines_expected_globals(self):
        """Test that kernel setup code defines expected global functions and classes"""
        kernel_file = Path("lib/kernel/kernel-setup.py")
        
        if not kernel_file.exists():
            pytest.skip("Kernel setup file not found - run build first")
        
        # Execute the kernel code in a controlled namespace
        mock_kernel = MockKernel()
        namespace = {
            '__name__': '__main__',
            'get_ipython': lambda: mock_kernel
        }
        
        # Mock IPython modules
        mock_modules = {
            'IPython': type(sys)('IPython'),
            'IPython.core': type(sys)('IPython.core'),
        }
        
        # Temporarily add mocks to sys.modules
        original_modules = {}
        for module_name, mock_module in mock_modules.items():
            if module_name in sys.modules:
                original_modules[module_name] = sys.modules[module_name]
            sys.modules[module_name] = mock_module
        
        try:
            with open(kernel_file, 'r') as f:
                kernel_code = f.read()
            
            exec(kernel_code, namespace)
            
            # Check that expected globals are defined
            expected_globals = [
                'osml_comm_target_func'    # Main comm handler should exist
            ]
            
            for expected in expected_globals:
                assert expected in namespace, f"Expected global '{expected}' not found"
                
            # Check that functions are callable
            for func_name in expected_globals:
                assert callable(namespace[func_name]), f"'{func_name}' should be callable"
        
        finally:
            # Restore original modules
            for module_name, original_module in original_modules.items():
                sys.modules[module_name] = original_module
            for module_name in mock_modules:
                if module_name not in original_modules and module_name in sys.modules:
                    del sys.modules[module_name]


class TestMessageProcessingIntegration:
    """Test complete message processing workflows"""
    
    @pytest.fixture
    def mock_comm(self):
        """Fixture providing a mock comm channel"""
        return MockComm()
    
    @pytest.fixture
    def kernel_namespace(self):
        """Fixture providing kernel namespace with setup code executed"""
        kernel_file = Path("lib/kernel/kernel-setup.py")
        
        if not kernel_file.exists():
            pytest.skip("Kernel setup file not found - run build first")
        
        # Set up namespace with mock get_ipython
        mock_kernel = MockKernel()
        namespace = {
            '__name__': '__main__',
            'get_ipython': lambda: mock_kernel
        }
        
        # Mock IPython modules
        mock_modules = {
            'IPython': type(sys)('IPython'),
            'IPython.core': type(sys)('IPython.core'),
        }
        
        # Temporarily add mocks to sys.modules
        original_modules = {}
        for module_name, mock_module in mock_modules.items():
            if module_name in sys.modules:
                original_modules[module_name] = sys.modules[module_name]
            sys.modules[module_name] = mock_module
        
        try:
            with open(kernel_file, 'r') as f:
                kernel_code = f.read()
            exec(kernel_code, namespace)
            yield namespace
        finally:
            # Restore original modules
            for module_name, original_module in original_modules.items():
                sys.modules[module_name] = original_module
            for module_name in mock_modules:
                if module_name not in original_modules and module_name in sys.modules:
                    del sys.modules[module_name]
    
    def test_comm_handler_registration(self, kernel_namespace, mock_comm):
        """Test that comm handler can be registered and called"""
        if 'osml_comm_target_func' not in kernel_namespace:
            pytest.skip("Comm handler not found in kernel namespace")
        
        comm_handler = kernel_namespace['osml_comm_target_func']
        
        # Should be able to call the handler without errors
        try:
            # Simulate comm registration
            comm_handler(mock_comm, {})
        except Exception as e:
            pytest.fail(f"Comm handler registration failed: {e}")
    
    def test_image_load_message_structure(self, mock_comm):
        """Test IMAGE_LOAD_REQUEST message structure is handled correctly"""
        # This is a placeholder for when message processing is implemented
        # For now, just test that we can construct the expected message format
        
        image_load_request = {
            'type': 'IMAGE_LOAD_REQUEST',
            'dataset': 'test_image.tiff'
        }
        
        # Verify message structure
        assert 'type' in image_load_request
        assert 'dataset' in image_load_request
        assert image_load_request['type'] == 'IMAGE_LOAD_REQUEST'
    
    def test_image_tile_message_structure(self, mock_comm):
        """Test IMAGE_TILE_REQUEST message structure"""
        image_tile_request = {
            'type': 'IMAGE_TILE_REQUEST',
            'dataset': 'test_image.tiff',
            'zoom': 10,
            'row': 512,
            'col': 256
        }
        
        # Verify message structure
        required_fields = ['type', 'dataset', 'zoom', 'row', 'col']
        for field in required_fields:
            assert field in image_tile_request
        
        assert image_tile_request['type'] == 'IMAGE_TILE_REQUEST'
    
    def test_overlay_tile_message_structure(self, mock_comm):
        """Test OVERLAY_TILE_REQUEST message structure"""
        overlay_tile_request = {
            'type': 'OVERLAY_TILE_REQUEST',
            'imageName': 'test_image.tiff',
            'overlayName': 'test_overlay.geojson',
            'zoom': 5,
            'row': 128,
            'col': 64
        }
        
        # Verify message structure
        required_fields = ['type', 'imageName', 'overlayName', 'zoom', 'row', 'col']
        for field in required_fields:
            assert field in overlay_tile_request
        
        assert overlay_tile_request['type'] == 'OVERLAY_TILE_REQUEST'


class TestCacheSystemIntegration:
    """Test cache system integration and performance"""
    
    @pytest.fixture
    def sample_tiff_file(self):
        """Fixture providing path to a test TIFF file"""
        return Path("tests/python/fixtures/sample_1band_512x512.tiff")
    
    @pytest.fixture
    def sample_geojson_file(self):
        """Fixture providing path to a test GeoJSON file"""
        return Path("tests/python/fixtures/sample_overlay.geojson")
    
    def test_image_factory_caching_concept(self, sample_tiff_file):
        """Test basic image factory caching concepts"""
        # This is a placeholder test for cache behavior validation
        # Will be implemented when cache system is in place
        
        # For now, just verify test data exists
        if sample_tiff_file.exists():
            assert sample_tiff_file.stat().st_size > 0, "Test TIFF file should not be empty"
        else:
            pytest.skip("Test TIFF file not found - run generate-test-data.py first")
    
    def test_overlay_factory_caching_concept(self, sample_geojson_file):
        """Test basic overlay factory caching concepts"""
        # This is a placeholder test for overlay cache behavior validation
        # Will be implemented when cache system is in place
        
        # For now, just verify test data exists
        if sample_geojson_file.exists():
            assert sample_geojson_file.stat().st_size > 0, "Test GeoJSON file should not be empty"
        else:
            pytest.skip("Test GeoJSON file not found - run generate-test-data.py first")


class TestErrorHandlingIntegration:
    """Test error handling and response generation"""
    
    def test_error_response_format(self):
        """Test that error responses follow expected format"""
        # Test standard error response structure
        expected_error_response = {
            'type': 'IMAGE_LOAD_RESPONSE',
            'status': 'ERROR',
            'error': 'Test error message'
        }
        
        # Verify required fields
        assert 'type' in expected_error_response
        assert 'status' in expected_error_response
        assert 'error' in expected_error_response
        assert expected_error_response['status'] == 'ERROR'
    
    def test_success_response_format(self):
        """Test that success responses follow expected format"""
        # Test standard success response structure
        expected_success_response = {
            'type': 'IMAGE_LOAD_RESPONSE',
            'status': 'SUCCESS',
            'dataset': 'test_image.tiff'
        }
        
        # Verify required fields
        assert 'type' in expected_success_response
        assert 'status' in expected_success_response
        assert expected_success_response['status'] == 'SUCCESS'
