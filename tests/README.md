# Test

Nessun framework: ogni suite è uno script Node autonomo che stampa le proprie righe
PASS/FAIL ed esce con codice diverso da zero se qualcosa fallisce. Il runner
(`tests/run.js`) le lancia come processi separati e aggrega i risultati, così una
suite che va in crash non trascina le altre.

```bash
npm test              # backend + frontend (nessuno stack richiesto)
npm run test:frontend
npm run test:backend
npm run test:e2e      # richiede un'istanza in esecuzione
```

## I gruppi

| gruppo | cosa verifica | serve lo stack? |
|---|---|---|
| `backend/` | struttura dei sorgenti Python e presenza delle correzioni di sicurezza | no |
| `frontend/` | moduli del viewer e dell'editor, in jsdom con MapLibre simulato | no |
| `e2e/` | comportamento reale dell'API su un'istanza avviata | sì |

Le suite e2e leggono `TM_BASE` (default `http://localhost:8080`) e richiedono
`TM_ADMIN_PW`:

```bash
TM_ADMIN_PW="$(grep '^ADMIN_PASSWORD=' .env | cut -d= -f2-)" npm run test:e2e
```

## Aggiungere una suite

Crea `tests/<gruppo>/<nome>.test.js`. Deve stampare un riepilogo come ultima riga
e chiamare `process.exit(1)` in caso di fallimento — il runner la trova da solo.

Ogni suite qui dentro nasce da un bug realmente trovato: sono scritte per fallire
sul codice difettoso prima di passare su quello corretto.
