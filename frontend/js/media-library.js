/**
 * TalkingMaps – Media Library
 * All prompt/confirm replaced with App.modal/App.confirm
 */
const MediaLibrary = {
    async load() {
        const panel = document.getElementById('panel-media');
        if (!panel) return;
        panel.innerHTML = `<div class="tm-empty-state"><i class="bi bi-arrow-repeat spin"></i><p>${I18n.t('loading')}</p></div>`;

        try {
            const media = await Api.listMedia();
            this._render(panel, media);
        } catch (err) {
            panel.innerHTML = `<div class="tm-empty-state"><i class="bi bi-exclamation-triangle"></i><p>${App.escHtml(err.message)}</p></div>`;
        }
    },

    _render(panel, media) {
        const t = I18n.t.bind(I18n);
        const images = media.filter(m => m.mime_type?.startsWith('image'));
        const videos = media.filter(m => m.mime_type?.startsWith('video'));
        const audio = media.filter(m => m.mime_type?.startsWith('audio'));

        panel.innerHTML = `
            <div class="dashboard-header">
                <h2><i class="bi bi-image"></i> ${t('media.title')}</h2>
                <div class="dashboard-filters">
                    <span class="text-muted">${media.length} file · ${this._formatBytes(media.reduce((a, m) => a + (m.file_size || 0), 0))}</span>
                </div>
            </div>

            <div class="upload-zone mb-4" id="media-upload-zone">
                <i class="bi bi-cloud-arrow-up"></i>
                <p>${t('media.drop_hint')}</p>
                <small>${t('media.formats')}</small>
                <input type="file" id="media-upload-input" multiple accept="image/*,video/*,audio/*,.pdf" style="display:none">
            </div>

            <ul class="nav nav-tabs mb-3">
                <li class="nav-item">
                    <a class="nav-link active" data-bs-toggle="tab" href="#media-all">
                        ${t('media.all')} <span class="badge bg-secondary">${media.length}</span>
                    </a>
                </li>
                <li class="nav-item">
                    <a class="nav-link" data-bs-toggle="tab" href="#media-images">
                        <i class="bi bi-image"></i> ${t('media.images')} <span class="badge bg-secondary">${images.length}</span>
                    </a>
                </li>
                <li class="nav-item">
                    <a class="nav-link" data-bs-toggle="tab" href="#media-videos">
                        <i class="bi bi-camera-video"></i> ${t('media.videos')} <span class="badge bg-secondary">${videos.length}</span>
                    </a>
                </li>
                <li class="nav-item">
                    <a class="nav-link" data-bs-toggle="tab" href="#media-audio">
                        <i class="bi bi-music-note-beamed"></i> ${t('media.audio')} <span class="badge bg-secondary">${audio.length}</span>
                    </a>
                </li>
            </ul>

            <div class="tab-content">
                <div class="tab-pane fade show active" id="media-all">
                    <div class="media-grid">${this._renderMediaItems(media)}</div>
                </div>
                <div class="tab-pane fade" id="media-images">
                    <div class="media-grid">${this._renderMediaItems(images)}</div>
                </div>
                <div class="tab-pane fade" id="media-videos">
                    <div class="media-grid">${this._renderMediaItems(videos)}</div>
                </div>
                <div class="tab-pane fade" id="media-audio">
                    <div class="media-grid">${this._renderMediaItems(audio)}</div>
                </div>
            </div>

            ${media.length === 0 ? `<div class="tm-empty-state"><i class="bi bi-cloud-arrow-up"></i><p>${t('media.no_files')}</p></div>` : ''}
        `;

        this._setupUpload();
        this._setupMediaItems();
    },

    /**
     * Wire the grid tiles. Filenames are user-supplied, so they travel in data-*
     * attributes and are read via dataset rather than being interpolated into an
     * inline handler, where HTML escaping cannot protect the JS string context.
     */
    _setupMediaItems() {
        document.querySelectorAll('.media-item[data-media-id]').forEach(item => {
            item.addEventListener('click', () => this._showDetail(
                parseInt(item.dataset.mediaId, 10),
                item.dataset.mediaUrl,
                item.dataset.mediaName,
                item.dataset.mediaType,
            ));
        });
    },

    _renderMediaItems(items) {
        return items.map(m => {
            const isImage = m.mime_type?.startsWith('image');
            const isVideo = m.mime_type?.startsWith('video');
            const isAudio = m.mime_type?.startsWith('audio');

            let preview;
            if (isImage) {
                preview = `<img src="${App.escHtml(m.thumbnail_path || m.file_path)}" alt="${App.escHtml(m.original_name)}" loading="lazy">`;
            } else {
                const icon = isVideo ? 'bi-camera-video-fill' : isAudio ? 'bi-music-note-beamed' : 'bi-file-earmark';
                preview = `<div style="display:flex;align-items:center;justify-content:center;height:100%;background:var(--tm-surface)">
                    <i class="bi ${icon}" style="font-size:36px;opacity:0.3;color:var(--tm-text-muted)"></i>
                </div>`;
            }

            return `
                <div class="media-item" data-media-id="${App.escHtml(m.id)}" data-media-url="${App.escHtml(m.file_path)}"
                     data-media-name="${App.escHtml(m.original_name || '')}" data-media-type="${App.escHtml(m.mime_type || '')}">
                    ${preview}
                    <div class="media-overlay">${App.escHtml(m.original_name || m.filename)}</div>
                    ${!isImage ? `<div class="media-type-icon"><i class="bi ${isVideo ? 'bi-play-fill' : isAudio ? 'bi-music-note' : 'bi-file'}"></i></div>` : ''}
                </div>
            `;
        }).join('');
    },

    _setupUpload() {
        const zone = document.getElementById('media-upload-zone');
        const input = document.getElementById('media-upload-input');
        if (!zone || !input) return;

        zone.addEventListener('click', () => input.click());
        zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('dragover');
            this._uploadFiles(e.dataTransfer.files);
        });
        input.addEventListener('change', () => this._uploadFiles(input.files));
    },

    async _uploadFiles(files) {
        for (const file of files) {
            try {
                await Api.uploadMedia(file);
                App.toast(`"${file.name}" ${I18n.t('media.uploaded')}`, 'success');
            } catch (err) {
                App.toast(`${I18n.t('media.upload_error')} "${file.name}": ${err.message}`, 'danger');
            }
        }
        this.load();
    },

    _showDetail(id, url, name, mimeType) {
        const t = I18n.t.bind(I18n);
        const isImage = mimeType?.startsWith('image');
        const isVideo = mimeType?.startsWith('video');
        const isAudio = mimeType?.startsWith('audio');

        let preview;
        if (isImage) preview = `<img src="${App.escHtml(url)}" style="max-width:100%;max-height:400px;border-radius:8px">`;
        else if (isVideo) preview = `<video src="${App.escHtml(url)}" controls style="max-width:100%;border-radius:8px"></video>`;
        else if (isAudio) preview = `<audio src="${App.escHtml(url)}" controls style="width:100%"></audio>`;
        else preview = `<div class="text-center py-4"><i class="bi bi-file-earmark" style="font-size:48px;opacity:0.3;color:var(--tm-text-muted)"></i></div>`;

        const html = `
            <div class="modal fade" id="media-detail-modal" tabindex="-1">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">${App.escHtml(name)}</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body text-center">${preview}</div>
                        <div class="modal-footer">
                            <button class="btn btn-sm btn-outline-light" id="media-copy-url" data-url="${App.escHtml(url)}">
                                <i class="bi bi-clipboard"></i> ${t('action.copy_url')}
                            </button>
                            <button class="btn btn-sm btn-outline-danger" onclick="MediaLibrary._deleteMedia(${id})">
                                <i class="bi bi-trash"></i> ${t('action.delete')}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.getElementById('media-detail-modal')?.remove();
        document.body.insertAdjacentHTML('beforeend', html);

        const copyBtn = document.getElementById('media-copy-url');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                navigator.clipboard?.writeText(copyBtn.dataset.url);
                App.toast(t('media.url_copied'), 'success');
            });
        }

        new bootstrap.Modal(document.getElementById('media-detail-modal')).show();
    },

    async _deleteMedia(id) {
        const ok = await App.confirm(I18n.t('media.delete_confirm'), { danger: true });
        if (!ok) return;
        try {
            await Api.deleteMedia(id);
            bootstrap.Modal.getInstance(document.getElementById('media-detail-modal'))?.hide();
            App.toast(I18n.t('media.deleted'), 'success');
            this.load();
        } catch (err) { App.toast(err.message, 'danger'); }
    },

    _formatBytes(bytes) {
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    },
};
