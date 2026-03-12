# TalkingMaps – Guida Amministratore

## 1. Installazione e Deploy

### 1.1 Requisiti

- **Docker Desktop** (Windows/Mac) o Docker Engine + Docker Compose (Linux)
- **8 GB RAM** minimo consigliato
- **2 GB disco** per i container, più spazio per upload media

### 1.2 Primo avvio

```bash
# Clona/copia il progetto
cd C:\Users\...\talkingmaps-master

# Configura l'ambiente
cp .env.example .env
# Modifica .env con un editor di testo:
# - SECRET_KEY: genera una stringa random (es. openssl rand -hex 32)
# - POSTGRES_PASSWORD: password sicura per il database
# - ADMIN_PASSWORD: password per l'utente admin iniziale
# - ALLOWED_ORIGINS: URL pubblico del servizio (es. https://maps.tuosito.it)

# Avvia
docker-compose up -d --build

# Verifica che tutto funzioni
docker-compose ps
# Tutti i container devono essere "Up"
```

### 1.3 Aggiornamento

```bash
# Scarica le nuove versioni dei file
git pull  # oppure copia manualmente i file aggiornati

# Ricostruisci e riavvia
docker-compose up -d --build

# Il database viene aggiornato automaticamente al primo avvio
```

### 1.4 Backup

```bash
# Backup database
docker-compose exec db pg_dump -U talkingmaps -d talkingmaps > backup_$(date +%Y-%m-%d).sql

# Backup media uploads
docker cp $(docker-compose ps -q backend):/var/www/uploads ./uploads_backup

# Restore database
docker-compose exec -T db psql -U talkingmaps -d talkingmaps < backup.sql
```

### 1.5 Deploy in produzione

Per un deploy in produzione, aggiungere davanti un reverse proxy con HTTPS (es. Nginx Proxy Manager, Traefik, Caddy).

```bash
# Esempio con Nginx Proxy Manager
# 1. Modificare docker-compose.yml: togliere il mapping porta 8080
# 2. Aggiungere una network esterna condivisa con NPM
# 3. In NPM: proxy su http://frontend:80

# Oppure con Caddy (auto-HTTPS):
# caddy reverse-proxy --from maps.tuosito.it --to localhost:8080
```

## 2. Gestione Utenti

### 2.1 Ruoli

| Ruolo | Permessi |
|---|---|
| **admin** | Tutto: gestione utenti, basemap, layer, storie di tutti |
| **editor** | Crea/modifica storie, carica layer e media, gestisce propri contenuti |
| **viewer** | Visualizza storie pubbliche e condivise |

### 2.2 Creare un utente

1. Login come admin
2. Menu utente → **Utenti**
3. Click **Nuovo utente**
4. Compilare: username, password, nome, ruolo

### 2.3 Disabilitare un utente

1. Menu utente → **Utenti**
2. Click l'icona **pausa** accanto all'utente
3. L'utente non potrà più accedere ma i suoi contenuti restano

### 2.4 Reset password

1. Menu utente → **Utenti**
2. Click l'icona **chiave** accanto all'utente
3. Inserire la nuova password

## 3. Gestione Basemap

Le basemap sono le mappe di sfondo disponibili per tutte le storie.

1. Menu utente → **Basemap**
2. Per aggiungere: specificare nome, tipo (xyz/wms/wmts), URL
3. Le basemap possono essere attivate/disattivate

### Basemap predefinite
- OpenStreetMap
- Satellite (ESRI)
- CartoDB Positron (chiaro)
- CartoDB Dark Matter (scuro)
- Stamen Watercolor

### Aggiungere WMS regionale come basemap

```
Nome: Ortofoto Veneto
Tipo: wms
URL: https://idt2-geoserver.regione.veneto.it/geoserver/wms
Config: {"layers": "ortofoto_2020", "format": "image/png", "transparent": true}
```

## 4. Configurazione WMS Proxy

Il proxy WMS gestisce le richieste verso servizi WMS esterni, risolvendo problemi CORS.

### Whitelist

La lista degli host consentiti è in `backend/routers/wms_proxy.py`. Per aggiungere un nuovo host:

```python
ALLOWED_HOSTS = [
    # ... host esistenti ...
    "geoserver.tuoente.it",  # Aggiungi qui
]
```

Riavviare il backend dopo la modifica:
```bash
docker-compose restart backend
```

## 5. Import dati CKAN

TalkingMaps può importare dataset da portali open data CKAN.

### Portali pre-configurati
- dati.gov.it (portale nazionale)
- data.europa.eu
- dati.venezia.it
- dati.trentino.it

### Formati supportati
- **GeoJSON** → importato direttamente come layer
- **CSV con coordinate** → convertito in GeoJSON (specificare campi lat/lon)
- **WMS/WFS** → aggiunto come servizio remoto

## 6. Monitoraggio

### Logs
```bash
# Tutti i log
docker-compose logs -f

# Solo backend
docker-compose logs -f backend

# Solo database
docker-compose logs -f db
```

### Health check
```bash
curl http://localhost:8080/health
# {"status":"ok"}
```

### Swagger API
```
http://localhost:8080/api/docs
```

## 7. Troubleshooting

| Problema | Soluzione |
|---|---|
| Container non partono | `docker-compose down -v && docker-compose up -d --build` |
| Errore database | Controllare log: `docker-compose logs db` |
| Upload fallisce | Verificare spazio disco e permessi volume `uploads` |
| WMS non funziona | Verificare che l'host sia nella whitelist del proxy |
| Login non funziona | Verificare che Redis sia attivo: `docker-compose logs redis` |
| Porta occupata | Cambiare porta in docker-compose.yml |
