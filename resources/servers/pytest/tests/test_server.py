import unittest
from unittest.mock import patch, MagicMock
import sys
import os

# Adjust path to import server from parent directory
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server

class TestPytestServer(unittest.TestCase):
    
    @patch('subprocess.run')
    def test_run_tool_runAll(self, mock_subprocess):
        # Setup mock
        mock_subprocess.return_value.stdout = "Test Output"
        mock_subprocess.return_value.stderr = ""
        
        # Call
        result = server.run_tool("pytest.runAll", {})
        
        # Assert
        self.assertFalse(result.get("isError"))
        mock_subprocess.assert_called()
        cmd = mock_subprocess.call_args[0][0]
        self.assertEqual(cmd[0], "pytest")
        self.assertIn("--json-report", cmd)

    @patch('subprocess.run')
    def test_run_tool_runFile(self, mock_subprocess):
        # Setup mock
        mock_subprocess.return_value.stdout = "File Output"
        mock_subprocess.return_value.stderr = ""
        
        # Call
        result = server.run_tool("pytest.runFile", {"path": "tests/test_foo.py"})
        
        # Assert
        self.assertFalse(result.get("isError"))
        cmd = mock_subprocess.call_args[0][0]
        self.assertEqual(cmd[1], "tests/test_foo.py")
        self.assertIn("File Output", result["content"][0]["text"])

    def test_run_tool_unknown(self):
        result = server.run_tool("unknown", {})
        self.assertTrue(result.get("isError"))
        self.assertIn("Unknown tool", result["content"][0]["text"])

if __name__ == '__main__':
    unittest.main()
