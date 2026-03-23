# Backend

## Run

Use the `conda` `main` environment.

```powershell
& 'C:\Users\kenyo\miniconda3\Scripts\conda.exe' run -n main python -m uvicorn backend.server:app --reload
```

## Current Scope

- Workspace CRUD
- Session CRUD scoped by workspace
- Memory save/search/delete stubs
- Web search stub
- `/health` and `/v1/models`

The current implementation uses an in-memory store so the frontend and API wiring can be developed before SQLite and llama-server integration land.
