# TalkingMaps 2.0

**Strumento open-source per creare storymaps interattive e visualizzazioni di dati geospaziali.**

Pensato per giornalisti, ricercatori, studenti e chiunque voglia raccontare storie attraverso mappe, dati e contenuti multimediali.

## Caratteristiche

- **Storytelling scroll-driven** – Narrazione che si sincronizza con le mappe, ispirata a ESRI StoryMaps
- **Mappe 2D** con MapLibre GL JS – Basemap, layer WMS/WMTS/GeoJSON, marker, simbologia avanzata
- **Globe 3D** con CesiumJS – Terreno, 3D Tiles, nuvole di punti, mesh
- **Nuvole di punti** con Potree – Visualizzazione LiDAR dedicata
- **Grafici interattivi** con Chart.js – Bar, line, pie, scatter, radar, dashboard KPI
- **Libreria media** – Upload e gestione immagini, video, audio, PDF con thumbnailing automatico
- **Gestione layer** – Catalogo layer riutilizzabili, upload GeoJSON, WMS proxy per servizi esterni
- **Simbologia avanzata** – Simple, graduated, categorized, rule-based, heatmap, cluster, icon, label
- **Import dati CKAN** – Cerca e importa dataset da portali open data (dati.gov.it, data.europa.eu, ecc.)
- **Gestione utenti** – Ruoli admin/editor/viewer, autenticazione JWT
- **Condivisione** – Storie pubbliche, link di condivisione, embed
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

# 3. Avviare i container
docker-compose up -d --build

# 4. Attendere che il database sia pronto (circa 30 secondi al primo avvio)
docker-compose logs -f backend
# Aspettare: "[INIT] Admin user 'admin' created"

# 5. Aprire il browser
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
docker-compose exec db psql -U talkingmaps -d talkingmaps

# Backup database
docker-compose exec db pg_dump -U talkingmaps talkingmaps > backup.sql
```

### Troubleshooting Windows

- **Porta 8080 già in uso**: Modificare la porta in `docker-compose.yml` (riga `ports: "8080:80"`)
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
│   ├── setup.sql               # Schema database
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
│       └── ckan.py             # Import da portali CKAN
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

Con il backend in esecuzione, la documentazione Swagger è disponibile su:

**http://localhost:8080/api/docs**

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
| Basemap | `GET /api/basemaps/` | Lista basemap disponibili |

## Licenza

GNU General Public License v3.0

## Autore

Federico Gianoli – [TalkingMaps](https://github.com/gianoli)
