/**
 * TalkingMaps – Scroll Animations
 * Animated key-figure counters and staggered text reveals for the story viewer.
 *
 * Two independent features live here:
 *  - Stats: a grid of key figures that count up from zero when the slide enters
 *  - Text reveal: word-by-word or child-by-child staggered entrance animations,
 *    driven by the per-slide `transition` setting
 */
const TmAnimate = {

    _prefersReduced() {
        return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    },

    /**
     * Strict numeric coercion: the whole value must be a number.
     * parseFloat would happily turn "1.2M" into 1.2 and silently drop the unit,
     * so a pre-formatted figure like that is better shown as the author wrote it.
     * @returns {number} NaN when the value is not entirely numeric
     */
    _toNumber(value) {
        if (typeof value === 'number') return isFinite(value) ? value : NaN;
        const str = String(value ?? '').trim();
        if (!str) return NaN;
        const num = Number(str);
        return isFinite(num) ? num : NaN;
    },

    // ── Number formatting ────────────────
    _format(value, opts = {}) {
        const decimals = Math.max(0, Math.min(6, parseInt(opts.decimals) || 0));
        let num;
        try {
            num = new Intl.NumberFormat(I18n?.getLang?.() || 'en', {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals,
            }).format(value);
        } catch {
            num = Number(value).toFixed(decimals);
        }
        return `${opts.prefix || ''}${num}${opts.suffix || ''}`;
    },

    /**
     * Animate a single number from `from` to `value` inside an element.
     * @param {HTMLElement} el
     * @param {object} opts - {value, from, prefix, suffix, decimals, duration}
     */
    countUp(el, opts = {}) {
        if (!el) return;
        if (el._tmRaf) { cancelAnimationFrame(el._tmRaf); el._tmRaf = null; }

        const target = this._toNumber(opts.value);
        if (!isFinite(target)) { el.textContent = `${opts.prefix || ''}${opts.value ?? ''}${opts.suffix || ''}`; return; }

        const rawDuration = parseInt(opts.duration);
        const duration = isFinite(rawDuration) ? Math.max(0, rawDuration) : 1800;
        if (duration === 0 || this._prefersReduced()) {
            el.textContent = this._format(target, opts);
            return;
        }

        const from = parseFloat(opts.from) || 0;
        const start = performance.now();
        const ease = t => 1 - Math.pow(1 - t, 3); // easeOutCubic

        const step = (now) => {
            const t = Math.min(1, (now - start) / duration);
            el.textContent = this._format(from + (target - from) * ease(t), opts);
            if (t < 1) {
                el._tmRaf = requestAnimationFrame(step);
            } else {
                el._tmRaf = null;
                el.textContent = this._format(target, opts);
            }
        };
        el.textContent = this._format(from, opts);
        el._tmRaf = requestAnimationFrame(step);
    },

    /**
     * Render a grid of key figures. Values start at zero — call runStats() to animate.
     * @param {HTMLElement} container
     * @param {object} config - {items: [{value, label, desc, prefix, suffix, decimals}], columns, duration}
     * @returns {boolean} true if anything was rendered
     */
    renderStats(container, config) {
        const items = (config?.items || []).filter(it => it && it.value !== undefined && it.value !== null && it.value !== '');
        if (!container || !items.length) return false;

        const cols = Math.max(1, Math.min(4, parseInt(config.columns) || Math.min(items.length, 4)));
        const duration = config.duration === undefined ? 1800 : Math.max(0, parseInt(config.duration) || 0);

        const wrap = document.createElement('div');
        wrap.className = 'tm-stats';
        wrap.style.setProperty('--tm-stats-cols', cols);

        items.forEach(it => {
            const decimals = Math.max(0, Math.min(6, parseInt(it.decimals) || 0));

            const cell = document.createElement('div');
            cell.className = 'tm-stat';

            const val = document.createElement('div');
            val.className = 'tm-stat-value';
            val.dataset.value = it.value;
            val.dataset.prefix = it.prefix || '';
            val.dataset.suffix = it.suffix || '';
            val.dataset.decimals = decimals;
            val.dataset.duration = duration;
            if (it.color) val.style.color = it.color;
            // Non-numeric values (a pre-formatted "1.2M", say) have nothing to count up
            // to, so show them as they are rather than flashing a zero first
            val.textContent = isFinite(this._toNumber(it.value))
                ? this._format(0, { prefix: it.prefix, suffix: it.suffix, decimals })
                : `${it.prefix || ''}${it.value}${it.suffix || ''}`;
            cell.appendChild(val);

            const label = document.createElement('div');
            label.className = 'tm-stat-label';
            label.textContent = it.label || '';
            cell.appendChild(label);

            if (it.desc) {
                const desc = document.createElement('div');
                desc.className = 'tm-stat-desc';
                desc.textContent = it.desc;
                cell.appendChild(desc);
            }

            wrap.appendChild(cell);
        });

        container.appendChild(wrap);
        return true;
    },

    /**
     * Start (or restart) the count-up for every stat inside a scope element.
     * @param {HTMLElement} scopeEl
     */
    runStats(scopeEl) {
        if (!scopeEl) return;
        const values = scopeEl.querySelectorAll('.tm-stat-value');
        if (!values.length) return;

        // Cancel staggered starts still pending from a previous entrance
        (scopeEl._tmStatTimers || []).forEach(clearTimeout);
        scopeEl._tmStatTimers = [];

        values.forEach((el, i) => {
            const opts = {
                // Raw, not parsed: countUp() parses it itself and falls back to showing
                // the value verbatim when it isn't a number (e.g. a pre-formatted "1.2M")
                value: el.dataset.value,
                prefix: el.dataset.prefix,
                suffix: el.dataset.suffix,
                decimals: parseInt(el.dataset.decimals) || 0,
                duration: parseInt(el.dataset.duration),
            };
            scopeEl._tmStatTimers.push(setTimeout(() => this.countUp(el, opts), i * 120));
        });
    },

    // ── Text reveal ──────────────────────
    /**
     * Prepare a slide's content for a text-reveal transition. Called once at build time;
     * the animation itself is triggered by the .slide-animate-in class.
     * @param {HTMLElement} contentEl
     * @param {string} transition
     */
    prepareText(contentEl, transition) {
        if (!contentEl) return;

        if (transition === 'reveal-words') {
            contentEl.querySelectorAll('h1, h2').forEach(h => this._splitWords(h));
        } else if (transition === 'stagger') {
            Array.from(contentEl.children).forEach((child, i) => {
                child.classList.add('tm-stagger-item');
                child.style.setProperty('--tm-i', i);
            });
        }
    },

    /**
     * Wrap each word of a plain-text heading in spans so it can slide up individually.
     * Headings containing markup are left untouched.
     */
    _splitWords(el) {
        if (!el || el.dataset.tmSplit === '1') return;
        if (el.children.length > 0) return; // don't destroy inline markup
        const words = (el.textContent || '').split(/\s+/).filter(Boolean);
        if (!words.length) return;

        el.textContent = '';
        words.forEach((w, i) => {
            const outer = document.createElement('span');
            outer.className = 'tm-word';
            const inner = document.createElement('span');
            inner.className = 'tm-word-inner';
            inner.style.setProperty('--tm-i', i);
            inner.textContent = w;
            outer.appendChild(inner);
            el.appendChild(outer);
            if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
        });
        el.dataset.tmSplit = '1';
    },
};
