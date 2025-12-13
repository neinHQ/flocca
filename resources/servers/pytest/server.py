import sys
import json
import subprocess
import os

def log(msg):
    with open("/tmp/flocca_pytest_debug.log", "a") as f:
        f.write(str(msg) + "\n")
    sys.stderr.write(str(msg) + "\n")
    sys.stderr.flush()

def run_tool(name, args):
    if name == "pytest.runAll":
        cmd = ["pytest", "--json-report", "--json-report-file=/tmp/pytest_report.json"]
        
        # Inject user provided args
        extra_args = os.environ.get("PYTEST_ARGS", "")
        if extra_args:
             cmd.extend(extra_args.split())

        # If directory arg provided
        if "directory" in args:
             cmd.append(args["directory"])
        
        try:
            subprocess.run(cmd, check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            # Read header report if exists (using pytest-json-report plugin assumption or just stdout as fallback)
            # For MVP simplicity, let's just return stdout if plugin not present, or try to read file
            # Ideally user needs pytest-json-report installed.
            # Fallback: just return stdout/stderr
            return {"content": [{"type": "text", "text": "Pytest executed. See logs."}]}
        except FileNotFoundError:
            return {"isError": True, "content": [{"type": "text", "text": "Pytest not found. Please ensure it is installed (`pip install pytest`) and in your PATH."}]}
        except Exception as e:
            return {"isError": True, "content": [{"type": "text", "text": str(e)}]}
            
    if name == "pytest.runFile":
        path = args.get("path")
        if not path:
             return {"isError": True, "content": [{"type": "text", "text": "path required"}]}
        cmd = ["pytest", path]
        try:
            result = subprocess.run(cmd, check=False, text=True, capture_output=True)
            return {"content": [{"type": "text", "text": result.stdout + "\\n" + result.stderr}]}
        except Exception as e:
            return {"isError": True, "content": [{"type": "text", "text": str(e)}]}

    return {"isError": True, "content": [{"type": "text", "text": f"Unknown tool {name}"}]}

def main():
    log("Pytest Server Starting...")
    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                log("Stdin closed, exiting.")
                break
            log(f"Received: {line.strip()}")
            request = json.loads(line)
            
            # Basic JSON-RPC 2.0 handling or MCP Protocol
            # MCP uses JSON-RPC 2.0
            
            if request.get("method") == "initialize":
                response = {
                    "jsonrpc": "2.0",
                    "id": request.get("id"),
                    "result": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {
                            "tools": {}
                        },
                        "serverInfo": {
                            "name": "pytest-mcp",
                            "version": "0.1.0"
                        }
                    }
                }
                print(json.dumps(response), flush=True)
                continue
            
            if request.get("method") == "tools/list":
                 response = {
                    "jsonrpc": "2.0",
                    "id": request.get("id"),
                    "result": {
                        "tools": [
                            {
                                "name": "pytest.runAll",
                                "description": "Run all tests",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "directory": { "type": "string" }
                                    }
                                }
                            },
                             {
                                "name": "pytest.runFile",
                                "description": "Run tests in file",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "path": { "type": "string" }
                                    },
                                    "required": ["path"]
                                }
                            }
                        ]
                    }
                }
                 print(json.dumps(response), flush=True)
                 continue

            if request.get("method") == "tools/call":
                params = request.get("params", {})
                name = params.get("name")
                args = params.get("arguments", {})
                result = run_tool(name, args)
                response = {
                    "jsonrpc": "2.0",
                    "id": request.get("id"),
                    "result": result
                }
                print(json.dumps(response), flush=True)
                continue
                
            # Handle other messages blindly or ignore
            
        except Exception as e:
            log(f"Error: {e}")
            break

if __name__ == "__main__":
    main()
