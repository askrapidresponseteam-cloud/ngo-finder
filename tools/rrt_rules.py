"""Put the directory's rules block into Rapid Response's rules file.

The block is the part of firestore.rules between the NGO-DIRECTORY markers.
It goes inside "match /databases/{database}/documents { ... }" of RRT's rules
(rrt-platform/backend/functions/firestore-security-rules.rules); running this
again replaces the block, never adds a second one.

    python3 tools/rrt_rules.py --block              # print the block
    python3 tools/rrt_rules.py RRT_RULES_FILE       # update that file in place
"""
import os
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
START = "    // ===== NGO-DIRECTORY START ====="
END = "// ===== NGO-DIRECTORY END ====="


def block():
    with open(os.path.join(HERE, "firestore.rules"), encoding="utf-8") as fh:
        s = fh.read()
    a, b = s.index(START), s.index(END)
    return s[a:b + len(END)] + "\n"


def merge(rrt):
    if START.strip() in rrt:
        a = rrt.index(START)
        b = rrt.index(END) + len(END) + 1
        rrt = rrt[:a] + rrt[b:]
    last = rrt.rindex("}")
    inner = rrt.rindex("}", 0, last)
    return rrt[:inner].rstrip() + "\n\n" + block() + "  " + rrt[inner:]


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    if sys.argv[1] == "--block":
        sys.stdout.write(block())
    else:
        path = sys.argv[1]
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(merge(text))
        print("directory rules block placed in " + path)
