# TalkingMaps – Guida Utente

## 1. Primi passi

### 1.1 Accesso

1. Aprire il browser all'indirizzo del servizio (es. `http://localhost:8080`)
2. Inserire **username** e **password**
3. Click **Accedi**

Per esplorare le storie pubbliche senza login: click su **"Esplora le storie pubbliche"**.

### 1.2 Dashboard

Dopo il login vedrai la **Dashboard** con:
- **Statistiche**: numero totale storie, pubblicate, bozze
- **Griglia storie**: tutte le tue storie con anteprima
- **Filtri**: cerca per titolo o filtra per stato (bozza/pubblicata/archiviata)

## 2. Creare una storia

### 2.1 Nuova storia

1. Click **+ Nuova storia** nella barra superiore
2. Inserisci il titolo
3. Si apre l'**Editor** con la prima slide (copertina)

### 2.2 L'Editor

L'editor è diviso in 3 pannelli:

```
┌──────────────┬──────────────────┬──────────────┐
│  SLIDE       │     MAPPA        │  PROPRIETÀ   │
│  (sinistra)  │    (centro)      │  (destra)    │
└──────────────┴──────────────────┴──────────────┘
```

- **Sinistra**: lista slide, drag & drop per riordinare
- **Centro**: anteprima mappa interattiva
- **Destra**: proprietà della slide selezionata

### 2.3 Aggiungere slide

1. Click **+** nel pannello slide
2. La nuova slide viene aggiunta in fondo
3. Trascina per riordinare

### 2.4 Layout slide

Ogni slide può avere un layout diverso:

| Layout | Descrizione |
|---|---|
| **Copertina** | Testo centrato, ideale per il titolo |
| **Lato SX** | Testo a sinistra, mappa a destra |
| **Lato DX** | Testo a destra, mappa a sinistra |
| **Centro** | Testo sovrapposto al centro della mappa |
| **Solo Mappa** | Solo mappa, senza testo |
| **Solo Media** | Immagine/video a schermo pieno con testo in basso |

### 2.5 Scrivere il testo narrativo

L'editor di testo supporta:
- **Grassetto**, *corsivo*
- Liste puntate e numerate
- Link (click icona catena)
- Immagini inline (click icona immagine)
- Embed iframe (click icona codice) – YouTube, Google Sheets, dashboard esterne

### 2.6 Configurare la vista mappa

Per ogni slide puoi impostare una vista mappa diversa:

1. Naviga la mappa nell'editor fino alla vista desiderata
2. Click **📷 Cattura vista corrente** (o bottone fotocamera)
3. La posizione (centro, zoom, rotazione, inclinazione) viene salvata
4. Scegli il tipo di **animazione**: Volo (flyTo), Scorrevole (easeTo), Istantanea (jumpTo)

### 2.7 Aggiungere marker

1. Click l'icona **📍** nella toolbar mappa
2. Click sulla mappa dove vuoi il marker
3. Inserisci il titolo
4. Il marker verrà mostrato solo nella slide corrente

### 2.8 Gestire i layer

1. Click l'icona **layer** nella toolbar mappa
2. Si apre il pannello layer dove puoi:
   - **Caricare un GeoJSON** dal tuo computer
   - **Aggiungere un WMS** da un servizio esterno
   - Aggiungere/rimuovere layer dalla storia
3. Per ogni slide puoi controllare la **visibilità** dei layer nel pannello proprietà

## 3. Grafici e Dashboard

### 3.1 Aggiungere un grafico a una slide

Nel pannello proprietà, sezione **Dati & Grafici**, inserisci la configurazione JSON:

```json
{
    "type": "bar",
    "labels": ["Gen", "Feb", "Mar", "Apr", "Mag"],
    "data": [120, 190, 300, 250, 420],
    "options": {
        "label": "Visitatori mensili"
    }
}
```

**Tipi disponibili:**
- `bar` – Grafico a barre (orizzontale con `options.horizontal: true`)
- `line` – Grafico a linee (con riempimento)
- `pie` – Grafico a torta
- `doughnut` – Ciambella
- `scatter` – Dispersione
- `radar` – Radar

### 3.2 Dashboard KPI

Puoi aggiungere widget KPI nelle slide. Nella configurazione dello style_overrides:

```json
{
    "dashboard": [
        {"label": "Popolazione", "value": "59.5M", "icon": "people", "color": "#1a73e8"},
        {"label": "Superficie", "value": "301,340 km²", "icon": "geo-alt", "color": "#34a853"},
        {"label": "Comuni", "value": "7,904", "icon": "building", "color": "#fbbc04"}
    ]
}
```

## 4. Importare dati

### 4.1 Upload GeoJSON

1. Editor → icona layer → **Carica GeoJSON**
2. Seleziona il file `.geojson` dal tuo computer
3. Il layer viene creato automaticamente con stile predefinito

### 4.2 Aggiungere servizi WMS

1. Editor → icona layer → **Aggiungi WMS**
2. Inserisci l'URL del servizio (es. `https://geoserver.regione.veneto.it/geoserver/wms`)
3. Inserisci il nome del layer WMS

### 4.3 Import da CKAN (Open Data)

Tramite API puoi cercare e importare dataset da portali open data:

```
GET /api/ckan/search?portal_url=https://dati.gov.it&q=comuni
```

## 5. Vista 3D

### 5.1 Attivare la vista 3D

Nel viewer della storia, click il bottone **3D** nella toolbar. La mappa 2D viene sostituita dal globe CesiumJS con:
- Terreno 3D realistico
- Navigazione orbitale
- Marker 3D

### 5.2 Nuvole di punti

Se configurate dall'amministratore, le slide possono includere visualizzazioni di nuvole di punti LiDAR (via Potree).

### 5.3 3D Tiles

Il sistema supporta l'aggiunta di dataset 3D Tiles (edifici, mesh, modelli) nelle impostazioni della storia.

## 6. Pubblicare e Condividere

### 6.1 Anteprima

Nell'editor, click **👁 Anteprima** per vedere la storia come la vedranno i lettori.

### 6.2 Pubblicare

1. Dashboard → click **⋯** sulla card della storia
2. Click **Pubblica**
3. La storia diventa visibile a tutti (se pubblica) o tramite link (se non listata)

### 6.3 Condividere

1. Dashboard → click **⋯** → **Condividi**
2. Il link di condivisione viene copiato negli appunti
3. Il link funziona anche per chi non ha un account

### 6.4 Incorporare (Embed)

Per incorporare una storia in un sito web:

```html
<iframe src="http://tuo-server:8080?story=ID_STORIA"
        width="100%" height="600" frameborder="0"
        allow="fullscreen"></iframe>
```

## 7. Navigazione delle storie

### Controlli disponibili nel viewer

| Controllo | Azione |
|---|---|
| **Scroll** | Avanza/indietro tra le slide |
| **Freccia giù/su** | Slide successiva/precedente |
| **Freccia dx/sx** | Slide successiva/precedente |
| **Spazio** | Slide successiva |
| **Esc** | Chiudi il viewer |
| **F** | Schermo intero |
| **Bottoni ▲▼** | Navigazione in basso a destra |
| **Icona mappa** | Cambia basemap |
| **Icona 3D** | Attiva/disattiva vista 3D |

## 8. Libreria Media

### 8.1 Caricare file

1. Menu utente → **Libreria Media**
2. Trascina file nella zona di upload, oppure click per selezionare
3. Formati supportati: JPEG, PNG, GIF, WebP, SVG, MP4, WebM, MP3, OGG, WAV, PDF

### 8.2 Usare i media nelle storie

- Come **sfondo slide**: nel pannello proprietà, sezione Sfondo
- Come **immagine nel testo**: nell'editor narrativo, click icona immagine
- Come **copertina storia**: nelle impostazioni della storia

### 8.3 Limiti

- Dimensione massima file: 50 MB (configurabile dall'amministratore)
- Le immagini vengono ridimensionate automaticamente per le thumbnail (400px)
