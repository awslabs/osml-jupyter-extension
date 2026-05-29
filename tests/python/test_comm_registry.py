"""
Tests for CommRegistry and the router's receiving-comm reply fix.
"""

import aws.osml.jupyter.main as main
from fixtures.mock_comm import MockComm, MockKernel

from aws.osml.jupyter.comm_registry import CommRegistry
from aws.osml.jupyter.main import initialize


class TestCommRegistry:
    """Unit tests for CommRegistry lifecycle and broadcast"""

    def test_register_and_len(self):
        registry = CommRegistry()
        comm = MockComm()
        registry.register(comm)
        assert len(registry) == 1

    def test_register_is_idempotent(self):
        registry = CommRegistry()
        comm = MockComm()
        registry.register(comm)
        registry.register(comm)
        assert len(registry) == 1

    def test_unregister(self):
        registry = CommRegistry()
        comm = MockComm()
        registry.register(comm)
        registry.unregister(comm)
        assert len(registry) == 0

    def test_unregister_unknown_is_noop(self):
        registry = CommRegistry()
        registry.unregister(MockComm())
        assert len(registry) == 0

    def test_broadcast_reaches_all_live_comms(self):
        registry = CommRegistry()
        comm_a = MockComm(comm_id="a")
        comm_b = MockComm(comm_id="b")
        registry.register(comm_a)
        registry.register(comm_b)

        reached = registry.broadcast({'type': 'ADD_LAYER'})

        assert reached == 2
        assert comm_a.get_last_message() == {'type': 'ADD_LAYER'}
        assert comm_b.get_last_message() == {'type': 'ADD_LAYER'}

    def test_broadcast_tolerates_and_prunes_dead_comm(self):
        registry = CommRegistry()
        dead = MockComm(comm_id="dead")
        live = MockComm(comm_id="live")
        dead.close()  # sending on a closed comm raises
        registry.register(dead)
        registry.register(live)

        reached = registry.broadcast({'type': 'SET_VIEW'})

        # The live comm still receives despite the dead one raising.
        assert reached == 1
        assert live.get_last_message() == {'type': 'SET_VIEW'}
        # The dead comm was pruned.
        assert len(registry) == 1
        assert registry.primary() is live

    def test_primary_is_most_recently_opened(self):
        registry = CommRegistry()
        first = MockComm(comm_id="first")
        second = MockComm(comm_id="second")
        registry.register(first)
        registry.register(second)
        assert registry.primary() is second

    def test_primary_none_when_empty(self):
        assert CommRegistry().primary() is None


class TestCommWiring:
    """Integration tests for registry wiring into the comm target func"""

    def test_open_registers_comm(self):
        mock_kernel = MockKernel()
        initialize(mock_kernel, force=True)

        mock_kernel.comm_manager.new_comm('osml_comm_target', {})

        assert len(main._comm_registry) == 1

    def test_close_unregisters_comm(self):
        mock_kernel = MockKernel()
        initialize(mock_kernel, force=True)

        comm = mock_kernel.comm_manager.new_comm('osml_comm_target', {})
        assert len(main._comm_registry) == 1

        comm.close()
        assert len(main._comm_registry) == 0


class TestRouterRepliesOnReceivingComm:
    """Regression for the comm_ref[0] bug: replies must go to the receiving comm"""

    def test_error_reply_goes_to_receiving_comm_with_two_open(self):
        mock_kernel = MockKernel()
        initialize(mock_kernel, force=True)

        comm_a = mock_kernel.comm_manager.new_comm('osml_comm_target', {})
        comm_b = mock_kernel.comm_manager.new_comm('osml_comm_target', {})
        comm_a.clear_messages()
        comm_b.clear_messages()

        # An unknown message type triggers the registry's error reply path.
        comm_a.simulate_message({'type': 'DEFINITELY_UNKNOWN_TYPE'})

        # The reply must land on comm_a (the receiving comm), not comm_b.
        assert any(
            msg.get('type') == 'DEFINITELY_UNKNOWN_TYPE_RESPONSE'
            for msg in comm_a.get_all_messages()
        )
        assert comm_b.message_count() == 0

    def test_second_comm_receives_its_own_reply(self):
        mock_kernel = MockKernel()
        initialize(mock_kernel, force=True)

        comm_a = mock_kernel.comm_manager.new_comm('osml_comm_target', {})
        comm_b = mock_kernel.comm_manager.new_comm('osml_comm_target', {})
        comm_a.clear_messages()
        comm_b.clear_messages()

        comm_b.simulate_message({'type': 'DEFINITELY_UNKNOWN_TYPE'})

        assert any(
            msg.get('type') == 'DEFINITELY_UNKNOWN_TYPE_RESPONSE'
            for msg in comm_b.get_all_messages()
        )
        assert comm_a.message_count() == 0
