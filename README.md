# TalkingMaps 2.0

**Strumento open-source per creare storymaps interattive e visualizzazioni di dati geospaziali.**

Pensato per giornalisti, ricercatori, studenti e chiunque voglia raccontare storie attraverso mappe, dati e contenuti multimediali.

## Caratteristiche

- **Storytelling scroll-driven** – Narrazione che si sincronizza con le mappe, ispirata a ESRI StoryMaps
- **Effetti narrativi** – Numeri chiave animati (contatori che salgono da zero allo scroll), transizioni testo parola-per-parola e a cascata, confronto immagini prima/dopo con maniglia trascinabile
- **Animazione temporale** – Filtra un layer su un campo data e riproducilo nel tempo, con barra play/pausa e scrubber
- **Narrazione audio** – Traccia audio per slide con controlli di riproduzione, upload dalla libreria media
- **Mappe 2D** con MapLibre GL JS – Basemap, layer WMS/WMTS/GeoJSON, marker, simbologia avanzata
- **Globe 3D** con CesiumJS – Terreno, 3D Tiles, nuvole di punti, mesh
- **Nuvole di punti** con Potree – Visualizzazione LiDAR dedicata
- **Upload dati 3D** – Carica LAS, LAZ, PLY, XYZ, PTS, GLB, GLTF, OBJ, FBX, IFC, 3DS, DAE, ZIP (3D Tiles), GeoTIFF (DEM), KML, KMZ con conversione automatica
- **Integrazione Cesium Ion** – Usa asset 3D ospitati su [Cesium Ion](https://cesium.com/learn/ion/) tramite Asset ID
- **Grafici interattivi** con Chart.js – Bar, line, pie, scatter, radar, dashboard KPI
- **Libreria media** – Upload e gestione immagini, video, audio, PDF con thumbnailing automatico
- **Gestione layer** – Catalogo layer riutilizzabili, upload GeoJSON, WMS proxy per servizi esterni
- **Simbologia avanzata** – Simple, graduated, categorized, rule-based, heatmap, cluster, icon, label
- **Import dati CKAN** – Cerca nel catalogo di un portale open data e importa una risorsa come layer, direttamente dall'editor. GeoJSON e WMS entrano così come sono, per i CSV si scelgono le colonne delle coordinate
- **Gestione utenti** – Ruoli admin/editor/viewer, autenticazione JWT
- **Condivisione** – Storie pubbliche, link di condivisione, embed
- **Assistente AI** – Genera testi, traduzioni, grafici e immagini con OpenAI (GPT/DALL-E), Anthropic (Claude), Google (Gemini). Chiavi API criptate per utente
- **Storymap di esempio** – Sette storie dimostrative pubbliche create all'avvio con `SEED_DEMO_STORIES=true`: tour cinematico, effetti narrativi, riproduzione temporale, globo 3D, immagine navigabile, hotspot nel testo e una storia costruita su dati aperti veri
- **Dockerizzato** – Deploy con un comando

## Stack Tecnologico

| Componente | Tecnologia |
|---|---|
| Frontend | Vanilla JS, MapLibre GL JS 5.x, CesiumJS, Chart.js, Bootstrap 5.3 |
| Backend | FastAPI (Python), SQLAlchemy async, asyncpg |
| Database | PostgreSQL 16 + PostGIS 3.4 |
| Cache | Redis 7 |
| Proxy | Nginx |
| Container | Docker Compose |

## Architettura

```
┌─────────────────────────────────────────────────┐
│                Docker Compose                    │
├───────────┬───────────┬───────────┬──────────────┤
│  Nginx    │  FastAPI  │ PostGIS   │   Redis      │
│  Frontend │  Backend  │ Database  │   Cache      │
│  :8080    │  :8000    │  :5432    │   :6379      │
└───────────┴───────────┴───────────┴──────────────┘
```

## Quick Start (Docker su Windows)

### Prerequisiti

1. **Docker Desktop for Windows** – [Download](https://www.docker.com/products/docker-desktop/)
   - Assicurarsi che WSL 2 sia abilitato
   - Nelle impostazioni Docker Desktop: Settings → Resources → WSL Integration → abilitato

2. **Git** (opzionale, per clonare il repo)

### Deploy in locale

```bash
# 1. Aprire un terminale (PowerShell, Git Bash, o WSL)
cd C:\Users\giano\Desktop\SVILUPPO\talkingmaps-master

# 2. Copiare e configurare il file .env (già presente con configurazione locale)
# Modificare .env se necessario (SECRET_KEY, password, ecc.)

# 3. Abilitare l'hot-reload del backend (solo sviluppo — non è in git di proposito,
#    così un git pull sul server non lo reintroduce)
cp docker-compose.override.yml.example docker-compose.override.yml

# 4. Avviare i container
docker-compose up -d --build

# 5. Attendere che il database sia pronto (circa 30 secondi al primo avvio)
docker-compose logs -f backend
# Aspettare: "[INIT] Admin user 'admin' created"

# 6. Aprire il browser
# http://localhost:8080
# Login: admin / admin
```

### Comandi utili

```bash
# Vedere i log
docker-compose logs -f

# Riavviare un servizio
docker-compose restart backend

# Fermare tutto
docker-compose down

# Fermare e cancellare i dati (database, upload)
docker-compose down -v

# Rebuild dopo modifiche al codice backend
docker-compose up -d --build backend

# Accesso al database
docker-compose exec db psql -U talkingmaps -d talkingmaps_data

# Backup database
docker-compose exec db pg_dump -U talkingmaps talkingmaps_data > backup.sql
docker-compose exec db pg_dump -U talkingmaps talkingmaps_system > backup_system.sql
```

### Troubleshooting Windows

- **Porta 8080 già in uso**: Avviare con `LISTEN_PORT=8099 docker compose up -d` (oppure modificare la porta in `docker-compose.yml`)
- **Upload che falliscono con 500 (`Permission denied: /var/www/uploads/...`)**: il volume `uploads` è più vecchio della versione in cui il backend ha iniziato a girare come utente non-root, quindi è rimasto di proprietà di `root`. Sistemarlo senza perdere i file già caricati:
  ```bash
  docker run --rm -v talkingmaps-master_uploads:/v alpine chown -R 999:999 /v
  ```
  Su un volume creato da zero il problema non si presenta.
- **Errore WSL**: Eseguire `wsl --install` da PowerShell come admin
- **Container non partono**: `docker-compose down -v && docker-compose up -d --build`
- **Hot-reload frontend**: Il frontend viene servito direttamente dalla cartella `frontend/` – le modifiche sono immediate (F5 nel browser)
- **Hot-reload backend**: Il backend ha `--reload` abilitato – le modifiche ai file Python si applicano automaticamente

## Struttura del Progetto

```
talkingmaps-master/
├── docker-compose.yml          # Orchestrazione container
├── .env                        # Configurazione (non committare in produzione!)
├── .env.example                # Template configurazione
│
├── backend/                    # FastAPI Python Backend
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py                 # Entry point FastAPI
│   ├── setup_system.sql        # Schema DB di sistema (utenti, basemap, simbologie)
│   ├── setup_data.sql          # Schema DB dati (storie, slide, layer, media)
│   ├── migrations/             # Migrazioni applicate automaticamente all'avvio
│   ├── core/
│   │   ├── config.py           # Configurazione da .env
│   │   ├── database.py         # SQLAlchemy async engine
│   │   └── security.py         # JWT, bcrypt, autorizzazione
│   └── routers/
│       ├── auth.py             # Login, logout, cambio password
│       ├── users.py            # Gestione utenti (admin)
│       ├── stories.py          # CRUD storie + duplicazione
│       ├── slides.py           # CRUD slide + marker
│       ├── layers.py           # Catalogo layer + upload GeoJSON
│       ├── symbology.py        # Simbologia + compilatore MapLibre
│       ├── media.py            # Upload media + thumbnailing
│       ├── basemaps.py         # Gestione basemap
│       ├── wms_proxy.py        # Proxy WMS con whitelist
│       ├── ckan.py             # Import da portali CKAN
│       ├── upload3d.py         # Upload e conversione dati 3D
│       ├── settings.py        # Impostazioni sistema (admin)
│       └── ai.py              # Assistente AI (multi-provider)
│
├── frontend/                   # Vanilla JS Frontend
│   ├── index.html              # Single-page application
│   ├── css/
│   │   ├── style.css           # Tema principale (dark)
│   │   ├── viewer.css          # Story viewer
│   │   ├── editor.css          # Story editor
│   │   └── dashboard.css       # Dashboard e cataloghi
│   └── js/
│       ├── api.js              # Client REST con gestione sessione
│       ├── app.js              # Controller principale, routing, auth
│       ├── map.js              # MapLibre GL JS wrapper
│       ├── cesium3d.js         # CesiumJS 3D globe wrapper
│       ├── potree-viewer.js    # Potree point cloud viewer
│       ├── charts.js           # Chart.js wrapper per grafici e dashboard
│       ├── animate.js          # Contatori animati e reveal del testo allo scroll
│       ├── compare-image.js    # Confronto immagini prima/dopo
│       ├── viewer.js           # Story viewer scroll-driven
│       ├── editor.js           # Story editor completo
│       ├── dashboard.js        # Dashboard, catalogo layer, utenti
│       └── media-library.js    # Libreria media con upload drag & drop
│
├── docker/
│   └── nginx.conf              # Configurazione reverse proxy
│
└── _old/                       # Vecchio progetto (backup)
```

## API Documentation

Con il backend in esecuzione, la documentazione Swagger è servita da FastAPI su `/docs`.
Nginx però inoltra al backend solo il prefisso `/api/`, quindi da fuori quel percorso
finisce sulla single-page app. Per raggiungerla, interrogare il container direttamente:

```bash
docker compose exec backend python -c "import urllib.request; print(urllib.request.urlopen('http://localhost:8000/openapi.json').read().decode()[:400])"
```

oppure pubblicare temporaneamente la porta del backend aggiungendo `ports: ["8000:8000"]`
al servizio `backend` e aprire **http://localhost:8000/docs**.

### Endpoint principali

| Gruppo | Endpoint | Descrizione |
|---|---|---|
| Auth | `POST /api/auth/login` | Login |
| Auth | `GET /api/auth/me` | Profilo utente corrente |
| Storie | `GET /api/stories/` | Lista storie |
| Storie | `POST /api/stories/` | Crea storia |
| Storie | `GET /api/stories/{id}/full` | Storia completa con slide, layer, marker |
| Storie | `POST /api/stories/{id}/duplicate` | Duplica storia |
| Slide | `GET /api/slides/story/{id}` | Slide di una storia |
| Slide | `PUT /api/slides/{id}` | Aggiorna slide (testo, mappa, layout) |
| Layer | `POST /api/layers/upload-geojson` | Carica file GeoJSON |
| Layer | `POST /api/layers/story/{id}` | Aggiungi layer a storia |
| Simbologia | `POST /api/symbology/` | Crea stile (auto-compila MapLibre) |
| Simbologia | `GET /api/symbology/presets` | Preset stili e color ramp |
| Media | `POST /api/media/upload` | Upload file multimediale |
| CKAN | `GET /api/ckan/search` | Cerca dataset su portali open data |
| CKAN | `POST /api/ckan/import-as-layer` | Importa dataset come layer |
| WMS | `GET /api/wms-proxy/tile` | Proxy WMS con whitelist CORS |
| 3D | `POST /api/3d/upload` | Carica file 3D (LAS, GLB, ZIP, KML...) |
| 3D | `GET /api/3d/` | Lista asset 3D caricati |
| 3D | `DELETE /api/3d/{asset_id}` | Elimina asset 3D |
| 3D | `GET /api/3d/quota` | Quota storage utente |
| Basemap | `GET /api/basemaps/` | Lista basemap disponibili |
| AI | `POST /api/ai/generate` | Genera testo con AI |
| AI | `POST /api/ai/generate-image` | Genera immagine con DALL-E |
| AI | `GET /api/ai/settings` | Impostazioni AI utente |
| AI | `GET /api/ai/providers` | Provider e modelli disponibili |
| Impostazioni | `GET /api/settings/` | Lista impostazioni sistema |
| Impostazioni | `PUT /api/settings/{key}` | Aggiorna impostazione |

## Dati 3D

TalkingMaps supporta il caricamento e la visualizzazione di dati 3D direttamente nelle storymaps.

### Formati supportati

| Categoria | Formati | Viewer |
|---|---|---|
| Nuvole di punti | LAS, LAZ, PLY, XYZ, PTS | Potree / Cesium |
| Mesh 3D | GLB, GLTF, OBJ, FBX, IFC, 3DS, DAE | Cesium |
| 3D Tiles | ZIP con tileset.json | Cesium |
| Terreno | GeoTIFF (DEM) | Cesium |
| Vettoriale 3D | KML, KMZ | Cesium |

### Come funziona

1. **Carica** il tuo file 3D dalla tab "Media & 3D" nell'editor
2. I file vengono **convertiti automaticamente** (es. LAS → 3D Tiles con py3dtiles, LAS → Potree con PotreeConverter)
3. **Seleziona** l'asset dalla lista e assegnalo alla slide corrente
4. Scegli il layout **Globo 3D** (Cesium) o **Nuvola punti** (Potree) per la visualizzazione

### Cesium Ion

Se preferisci un servizio cloud, puoi caricare i tuoi dati 3D su [Cesium Ion](https://cesium.com/learn/ion/) e usare l'Asset ID nell'editor. Cesium Ion offre:

- Hosting cloud per 3D Tiles, terreno e immagini
- Conversione automatica di molti formati
- Streaming ottimizzato per grandi dataset
- [Documentazione Cesium Ion](https://cesium.com/learn/ion/)

### Quota storage

Ogni utente ha una quota di storage per i dati 3D (default: 500 MB, configurabile dall'admin). La barra di quota è visibile nella tab "Media & 3D".

## Assistente AI

TalkingMaps integra un assistente AI multi-provider per aiutarti a creare contenuti.

### Provider supportati

| Provider | Modelli testo | Modelli immagine |
|---|---|---|
| OpenAI | GPT-4o, GPT-4o-mini, GPT-4-turbo, GPT-3.5-turbo | DALL-E 3, DALL-E 2 |
| Anthropic | Claude Sonnet 4, Claude Haiku 4.5 | — |
| Google | Gemini 2.0 Flash, Gemini 1.5 Pro | Imagen 3 |

### Cosa può fare

- **Generare narrativa** per le slide della storymap
- **Suggerire titoli** accattivanti
- **Migliorare testi** esistenti
- **Tradurre** in 6+ lingue
- **Riassumere** contenuti lunghi
- **Generare grafici** Chart.js da descrizioni testuali
- **Creare immagini** per sfondi slide (DALL-E)

### Configurazione

1. Vai su **Account** dal menu utente
2. Nella sezione **Assistente AI**, scegli il provider preferito
3. Inserisci la tua chiave API (ottienila dal sito del provider)
4. Clicca **Salva**

Nell'editor, clicca il pulsante **🤖** nella barra della narrativa per aprire l'assistente.

### Sicurezza delle chiavi API

Le chiavi API degli utenti sono protette con crittografia lato server:

- **Algoritmo**: Fernet (AES-128-CBC + HMAC-SHA256), standard industriale per la crittografia simmetrica
- **Derivazione chiave**: PBKDF2-HMAC-SHA256 con 480.000 iterazioni, derivata dalla SECRET_KEY del server
- **Storage**: Le chiavi sono criptate prima del salvataggio nel database — non sono mai memorizzate in chiaro
- **Accesso**: Solo l'utente proprietario può usare le proprie chiavi. Il server le decripta solo al momento della chiamata API
- **Mascheramento**: Nell'interfaccia le chiavi salvate mostrano solo gli ultimi 4 caratteri (es. `••••ab12`)
- **Cancellazione**: L'utente può rimuovere le proprie chiavi in qualsiasi momento

> **Nota**: La sicurezza delle chiavi dipende dalla SECRET_KEY configurata nel file `.env`. Usa una chiave lunga e casuale in produzione.

## Licenza

GNU General Public License v3.0

## Sponsor

TalkingMaps 2.0 è stato sponsorizzato e risviluppato da [StudioGIS.eu](https://studiogis.eu).

## Autori

Federico Gianoli & Martino Boni
