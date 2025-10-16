# Copyright Amazon.com, Inc. or its affiliates.

# Core infrastructure: Base classes, logging, performance monitoring, and error handling

import time
import logging
import traceback
from functools import wraps

class PerformanceMonitor:
    """Monitor and track performance metrics for message processing"""
    
    def __init__(self):
        self.request_counts = {}
        self.processing_times = {}
        self.error_counts = {}
    
    def track_request(self, message_type, processing_time):
        """Track a successful request"""
        if message_type not in self.request_counts:
            self.request_counts[message_type] = 0
            self.processing_times[message_type] = []
        
        self.request_counts[message_type] += 1
        self.processing_times[message_type].append(processing_time)
        
        # Keep only last 100 measurements per message type for memory management
        if len(self.processing_times[message_type]) > 100:
            self.processing_times[message_type] = self.processing_times[message_type][-100:]
    
    def track_error(self, message_type):
        """Track a failed request"""
        if message_type not in self.error_counts:
            self.error_counts[message_type] = 0
        self.error_counts[message_type] += 1
    
    def get_stats(self):
        """Get performance statistics"""
        stats = {}
        for message_type in self.request_counts:
            times = self.processing_times.get(message_type, [])
            avg_time = sum(times) / len(times) if times else 0
            max_time = max(times) if times else 0
            min_time = min(times) if times else 0
            
            stats[message_type] = {
                'request_count': self.request_counts[message_type],
                'error_count': self.error_counts.get(message_type, 0),
                'avg_processing_time': avg_time,
                'max_processing_time': max_time,
                'min_processing_time': min_time
            }
        return stats

class OSMLKernelLogger:
    """JupyterLab-compatible logging and error handling"""
    
    def __init__(self):
        self.logger = logging.getLogger('osml-jupyter-extension')
        if not self.logger.handlers:
            handler = logging.StreamHandler()
            formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
            handler.setFormatter(formatter)
            self.logger.addHandler(handler)
            self.logger.setLevel(logging.INFO)
        
        self.error_mappings = {
            "FileNotFoundError": "Image file not found",
            "PermissionError": "Insufficient permissions to access file",
            "MemoryError": "Insufficient memory to process request",
            "ValueError": "Invalid request parameters",
            "KeyError": "Missing required field in request",
            "RuntimeError": "Processing failed due to runtime error"
        }
    
    def log_error_detailed(self, operation, error, data=None):
        """Log detailed error information to kernel logs"""
        error_msg = f"Operation '{operation}' failed: {str(error)}"
        if data:
            error_msg += f" | Request data: {data}"
        
        self.logger.error(error_msg)
        self.logger.debug(traceback.format_exc())
    
    def get_user_friendly_message(self, error):
        """Convert technical errors to user-friendly messages"""
        error_type = type(error).__name__
        friendly_msg = self.error_mappings.get(error_type, "Processing failed")
        return f"{friendly_msg}: {str(error)}"
    
    def info(self, message):
        """Log info message"""
        self.logger.info(message)
    
    def debug(self, message):
        """Log debug message"""
        self.logger.debug(message)
    
    def warning(self, message):
        """Log warning message"""
        self.logger.warning(message)
    
    def error(self, message):
        """Log error message"""
        self.logger.error(message)

class BaseMessageProcessor:
    """Base class for all message processors"""
    
    def __init__(self, cache_manager, logger):
        self.cache_manager = cache_manager
        self.logger = logger
    
    def process(self, data, comm):
        """Process a message - subclasses must implement this method"""
        raise NotImplementedError("Subclasses must implement process method")
    
    def validate_request(self, data, required_fields):
        """Validate that required fields are present in request data"""
        missing = [field for field in required_fields if field not in data]
        if missing:
            raise ValueError(f"Missing required fields: {missing}")
