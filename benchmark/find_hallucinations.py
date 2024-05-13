import re
import json
from pathlib import Path
import fire

def find_hallucinations(jsonfile: str):
    with open(jsonfile, 'r') as f:
        data = json.load(f)
    result = {"package": data["metaData"]["packageName"], "stats": data["stats"], "hallucinations": []}
    for test_info in data["tests"]:
        if test_info["status"] == "FAILED" and ("is not a function" in test_info["err"]["message"] or re.search("Cannot read property '.*' of undefined", test_info["err"]["message"]) or "Cannot read properties of undefined" in test_info["err"]["message"]):
            test = "Test source not found"
            try:
                with open(Path(jsonfile).parent/"tests"/test_info["testFile"], 'r') as f:
                    test = f.read()
            except:
                pass
            hallucination = {
                "test_file": test_info["testFile"],
                "test": test,
                "api": test_info["api"],
                "err_msg": test_info["err"]["message"],
            }
            result["hallucinations"].append(hallucination)
    with open(Path(jsonfile).parent/"hallucinations.json", 'w') as f:
        json.dump(result, f, indent=4)
    return len(result["hallucinations"])

if __name__ == "__main__":
    fire.Fire(find_hallucinations)
