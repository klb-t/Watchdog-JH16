"""Real Linux TCP4/TCP6 header contracts; offline fixtures, no host mutation."""
import sys
from pathlib import Path
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]/'scripts'))
from devbox_common import SetupError, policy
from devbox_idle import decide, observe


class KernelContractTests(unittest.TestCase):
    def fixture(self, directory, tcp6):
        root = Path(directory)
        for name, text in {
            'proc/uptime': '9000 10\n', 'proc/loadavg': '0 0 0 1/100 9\n', 'run/who.txt': '',
            'proc/net/tcp': '  sl  local_address rem_address   st tx_queue rx_queue\n',
            'proc/net/tcp6': tcp6,
        }.items():
            p = root/name; p.parent.mkdir(parents=True, exist_ok=True); p.write_text(text)
        return root

    def test_actual_tcp6_header_uses_remote_address_not_rem_address(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.fixture(directory, '  sl  local_address                         remote_address                        st tx_queue rx_queue\n')
            self.assertEqual([], observe(root, policy(), 10000)[2])

    def test_ipv6_mapped_loopback_rdp_is_activity(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.fixture(directory, 'sl local_address remote_address st\n0: 00000000000000000000000000000000:0D3D 0000000000000000FFFF00000100007F:D210 01\n')
            self.assertTrue(observe(root, policy(), 10000)[2])

    def test_boolean_timestamp_is_corrupt_state_not_epoch_one(self):
        with self.assertRaises(SetupError):
            decide(10000, 9000, 1800, True, [], [])

    def test_unknown_header_still_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.fixture(directory, 'an incompatible table\n')
            with self.assertRaises(SetupError): observe(root, policy(), 10000)


if __name__ == '__main__': unittest.main()
