# Frontend Scripts

Python code-generation utilities for the BAREEQ frontend.

| Script | Description |
|--------|-------------|
| `create.py` | Generates the full frontend scaffold from scratch |
| `modify.py` | Patches an existing frontend — adds dark mode, webp background, chart fixes |
| `aa.py` | Earlier version of create.py (2-page, no Analytics) |
| `modify_patched.py` | Patched version of modify.py |

## Usage

```bash
cd frontend
python scripts/create.py   # scaffold from scratch
python scripts/modify.py   # apply patches to existing src
```
