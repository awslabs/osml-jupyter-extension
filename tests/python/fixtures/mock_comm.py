"""
Mock Jupyter comm channel for testing message processors
"""


class MockComm:
    """Mock Jupyter comm channel for testing"""
    
    def __init__(self):
        self.sent_messages = []
        self.message_handlers = []
        self.is_open = True
        self.comm_id = "test_comm_id"
        self.target_name = "osml-jupyter-extension"
    
    def send(self, data):
        """Mock sending a message"""
        if self.is_open:
            self.sent_messages.append(data)
        else:
            raise RuntimeError("Comm is closed")
    
    def on_msg(self, handler):
        """Mock registering a message handler"""
        self.message_handlers.append(handler)
    
    def simulate_message(self, msg_data):
        """Simulate receiving a message from frontend"""
        mock_msg = {
            'content': {
                'data': msg_data
            }
        }
        for handler in self.message_handlers:
            handler(mock_msg)
    
    def close(self):
        """Mock closing the comm channel"""
        self.is_open = False
    
    def get_last_message(self):
        """Get the last sent message"""
        return self.sent_messages[-1] if self.sent_messages else None
    
    def get_all_messages(self):
        """Get all sent messages"""
        return self.sent_messages.copy()
    
    def clear_messages(self):
        """Clear all sent messages"""
        self.sent_messages.clear()
    
    def message_count(self):
        """Get count of sent messages"""
        return len(self.sent_messages)


class MockKernel:
    """Mock Jupyter kernel for testing"""
    
    def __init__(self):
        self.comm_manager = MockCommManager()
        self.user_ns = {}
        # The kernel setup code accesses get_ipython().kernel
        self.kernel = self
    
    def execute(self, code):
        """Mock code execution in kernel namespace"""
        exec(code, self.user_ns)
    
    def get_variable(self, name):
        """Get a variable from kernel namespace"""
        return self.user_ns.get(name)


class MockCommManager:
    """Mock comm manager for testing"""
    
    def __init__(self):
        self.comms = {}
        self.targets = {}
    
    def register_target(self, target_name, handler):
        """Mock registering a comm target"""
        self.targets[target_name] = handler
    
    def new_comm(self, target_name, data=None):
        """Mock creating a new comm"""
        comm = MockComm()
        comm.target_name = target_name
        self.comms[comm.comm_id] = comm
        
        # Trigger target handler if registered
        if target_name in self.targets:
            self.targets[target_name](comm, data or {})
        
        return comm
    
    def get_comm(self, comm_id):
        """Get comm by ID"""
        return self.comms.get(comm_id)
