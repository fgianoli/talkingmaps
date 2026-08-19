/**
 * TalkingMaps – Before/After Image Comparison
 * Two images stacked with a draggable divider, for showing change over time
 * (satellite imagery, historical photos, before/after restoration...).
 *
 * Mouse, touch and keyboard driven. Unlike TmMap.enableCompare() — which swipes
 * between two live basemaps — this is an inline content block inside the narrative.
 */
const TmImageCompare = {

    /**
     * @param {HTMLElement} container
     * @param {object} config - {before_url, after_url, before_label, after_label, aspect, start}
     * @returns {HTMLElement|null} the widget element
     */
    render(container, config = {}) {
        const before = config.before_url;
        const after = config.after_url;
        if (!container || !before || !after) return null;

        // `|| 50` would swallow a deliberate 0, which the editor takes care to preserve
        const rawStart = parseFloat(config.start);
        const start = Math.max(0, Math.min(100, isFinite(rawStart) ? rawStart : 50));

        const widget = document.createElement('div');
        widget.className = 'tm-imgcmp';
        widget.style.setProperty('--tm-imgcmp-pos', start + '%');
        if (config.aspect) widget.style.aspectRatio = config.aspect;

        const beforeImg = document.createElement('img');
        beforeImg.className = 'tm-imgcmp-img';
        beforeImg.src = before;
        beforeImg.alt = config.before_label || '';
        beforeImg.draggable = false;
        widget.appendChild(beforeImg);

        const afterWrap = document.createElement('div');
        afterWrap.className = 'tm-imgcmp-after';
        const afterImg = document.createElement('img');
        afterImg.className = 'tm-imgcmp-img';
        afterImg.src = after;
        afterImg.alt = config.after_label || '';
        afterImg.draggable = false;
        afterWrap.appendChild(afterImg);
        widget.appendChild(afterWrap);

        if (config.before_label) {
            const l = document.createElement('div');
            l.className = 'tm-imgcmp-label tm-imgcmp-label-left';
            l.textContent = config.before_label;
            widget.appendChild(l);
        }
        if (config.after_label) {
            const r = document.createElement('div');
            r.className = 'tm-imgcmp-label tm-imgcmp-label-right';
            r.textContent = config.after_label;
            widget.appendChild(r);
        }

        const divider = document.createElement('div');
        divider.className = 'tm-imgcmp-divider';
        divider.setAttribute('role', 'slider');
        divider.setAttribute('tabindex', '0');
        divider.setAttribute('aria-valuemin', '0');
        divider.setAttribute('aria-valuemax', '100');
        divider.setAttribute('aria-valuenow', String(Math.round(start)));
        divider.setAttribute('aria-label', I18n?.t('viewer.compare_drag') || 'Drag to compare');
        divider.title = I18n?.t('viewer.compare_drag') || 'Drag to compare';

        const handle = document.createElement('div');
        handle.className = 'tm-imgcmp-handle';
        handle.innerHTML = '<i class="bi bi-arrows-expand"></i>';
        divider.appendChild(handle);
        widget.appendChild(divider);

        // ── Interaction ──
        let pos = start;
        const setPos = (pct) => {
            pos = Math.max(0, Math.min(100, pct));
            widget.style.setProperty('--tm-imgcmp-pos', pos + '%');
            divider.setAttribute('aria-valuenow', String(Math.round(pos)));
        };
        const posFromClientX = (clientX) => {
            const rect = widget.getBoundingClientRect();
            if (!rect.width) return pos;
            return ((clientX - rect.left) / rect.width) * 100;
        };

        let dragging = false;
        divider.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            dragging = true;
            widget.classList.add('dragging');
            divider.setPointerCapture?.(e.pointerId);
        });
        divider.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            e.preventDefault();
            setPos(posFromClientX(e.clientX));
        });
        const endDrag = (e) => {
            if (!dragging) return;
            dragging = false;
            widget.classList.remove('dragging');
            divider.releasePointerCapture?.(e.pointerId);
        };
        divider.addEventListener('pointerup', endDrag);
        divider.addEventListener('pointercancel', endDrag);

        // Click anywhere on the image jumps the divider there
        widget.addEventListener('click', (e) => {
            if (e.target.closest('.tm-imgcmp-divider')) return;
            setPos(posFromClientX(e.clientX));
        });

        // Keyboard: arrows nudge, Home/End snap
        divider.addEventListener('keydown', (e) => {
            const stepSize = e.shiftKey ? 10 : 2;
            if (e.key === 'ArrowLeft') { setPos(pos - stepSize); e.preventDefault(); }
            else if (e.key === 'ArrowRight') { setPos(pos + stepSize); e.preventDefault(); }
            else if (e.key === 'Home') { setPos(0); e.preventDefault(); }
            else if (e.key === 'End') { setPos(100); e.preventDefault(); }
        });

        container.appendChild(widget);
        return widget;
    },
};
