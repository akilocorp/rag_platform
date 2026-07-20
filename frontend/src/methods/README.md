# Experiential methods (frontend)

Each **method** is one teaching pedagogy with its **own schema (validator)** and its
**own player (Runner)**. A lab records which pedagogy it is via `config.method`;
`pages/ExperientialPage.jsx` reads that and mounts the matching validator + Runner
from the registry here.

```
src/methods/
  registry.js          ← the dispatcher (auto-discovers subfolders)
  <method-id>/
    index.{js,jsx}     ← default-exports { id, label, validate, Runner }
    schema.js          ← validate(config) -> { ok, errors }  (this method's shape)
    Player.jsx         ← the React player that renders this method's flow
```

## Add a new pedagogy = drop a subfolder

1. **Frontend** — create `src/methods/<id>/` with an `index.js` that default-exports:

   ```js
   import { validate } from './schema';
   import Runner from './Player';

   export default {
     id: '<id>',                       // matches config.method
     label: 'Human-readable name',
     validate,                          // (config) => { ok, errors }
     Runner,                            // <Runner config configId templateId onReset onBack
                                        //   isAuthenticated onSessionSaved onOpenMobileSidebar />
   };
   ```

   The registry auto-discovers it — no edits to `registry.js`, the page, or anything else.

2. **Backend** — add `src/experiential/methods/<id>.py` with that pedagogy's generation
   prompt (its JSON contract) and set `schema='<id>'`, so generated labs are stamped
   `config.method = '<id>'` and routed to your new player.

## The built-in `predict-reveal`

The original `predict → commit → reveal → explain` pedagogy is registered from
`pages/ExperientialPage.jsx` (its player still lives there) via `registerMethod(...)`.
It behaves exactly like a subfolder method and can be moved into `methods/predict-reveal/`
later as a pure relocation — the dispatch seam doesn't change either way.

Missing or unknown `config.method` falls back to `DEFAULT_METHOD_ID` (`predict-reveal`),
so every existing saved lab keeps working.
