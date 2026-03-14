/**
 * TalkingMaps – Gallery / Slideshow Component
 * Responsive image carousel with navigation, thumbnails, captions,
 * keyboard support, and touch swipe.
 */
const TmGallery = {

    /**
     * Render a gallery into a container element.
     * @param {HTMLElement} container - DOM element to render into
     * @param {Array} images - [{url, caption, alt}]
     * @param {Object} options - {autoplay: false, interval: 5000, showThumbs: true}
     */
    render(container, images, options = {}) {
        if (!container || !images || images.length === 0) return;

        const opts = {
            autoplay: options.autoplay || false,
            interval: options.interval || 5000,
            showThumbs: options.showThumbs !== false,
        };

        let currentIndex = 0;
        let autoplayTimer = null;

        // Build DOM
        const gallery = document.createElement('div');
        gallery.className = 'tm-gallery';
        gallery.tabIndex = 0;

        // Counter
        const counter = document.createElement('div');
        counter.className = 'tm-gallery-counter';
        counter.textContent = `1 / ${images.length}`;

        // Main image area
        const main = document.createElement('div');
        main.className = 'tm-gallery-main';

        const img = document.createElement('img');
        img.src = images[0].url;
        img.alt = images[0].alt || images[0].caption || '';
        img.draggable = false;
        main.appendChild(img);

        // Navigation arrows
        if (images.length > 1) {
            const prevBtn = document.createElement('button');
            prevBtn.className = 'tm-gallery-nav tm-gallery-prev';
            prevBtn.innerHTML = '<i class="bi bi-chevron-left"></i>';
            prevBtn.setAttribute('aria-label', 'Previous');
            prevBtn.addEventListener('click', (e) => { e.stopPropagation(); goTo(currentIndex - 1); });

            const nextBtn = document.createElement('button');
            nextBtn.className = 'tm-gallery-nav tm-gallery-next';
            nextBtn.innerHTML = '<i class="bi bi-chevron-right"></i>';
            nextBtn.setAttribute('aria-label', 'Next');
            nextBtn.addEventListener('click', (e) => { e.stopPropagation(); goTo(currentIndex + 1); });

            main.appendChild(prevBtn);
            main.appendChild(nextBtn);
        }

        main.appendChild(counter);

        // Caption
        const caption = document.createElement('div');
        caption.className = 'tm-gallery-caption';
        caption.textContent = images[0].caption || '';
        if (!images[0].caption) caption.style.display = 'none';

        // Thumbnails
        let thumbsContainer = null;
        if (opts.showThumbs && images.length > 1) {
            thumbsContainer = document.createElement('div');
            thumbsContainer.className = 'tm-gallery-thumbs';
            images.forEach((imgData, idx) => {
                const thumb = document.createElement('div');
                thumb.className = 'tm-gallery-thumb' + (idx === 0 ? ' active' : '');
                const thumbImg = document.createElement('img');
                thumbImg.src = imgData.url;
                thumbImg.alt = imgData.alt || imgData.caption || '';
                thumbImg.draggable = false;
                thumb.appendChild(thumbImg);
                thumb.addEventListener('click', (e) => { e.stopPropagation(); goTo(idx); });
                thumbsContainer.appendChild(thumb);
            });
        }

        // Assemble
        gallery.appendChild(main);
        gallery.appendChild(caption);
        if (thumbsContainer) gallery.appendChild(thumbsContainer);

        container.innerHTML = '';
        container.appendChild(gallery);

        // Navigation logic
        function goTo(index) {
            if (images.length === 0) return;
            // Wrap around
            if (index < 0) index = images.length - 1;
            if (index >= images.length) index = 0;
            currentIndex = index;

            img.src = images[index].url;
            img.alt = images[index].alt || images[index].caption || '';
            counter.textContent = `${index + 1} / ${images.length}`;

            if (images[index].caption) {
                caption.textContent = images[index].caption;
                caption.style.display = '';
            } else {
                caption.textContent = '';
                caption.style.display = 'none';
            }

            // Update thumbnails
            if (thumbsContainer) {
                thumbsContainer.querySelectorAll('.tm-gallery-thumb').forEach((t, i) => {
                    t.classList.toggle('active', i === index);
                });
                // Scroll active thumbnail into view
                const activeThumb = thumbsContainer.children[index];
                if (activeThumb) {
                    activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                }
            }

            // Reset autoplay timer
            if (autoplayTimer) {
                clearInterval(autoplayTimer);
                if (opts.autoplay) startAutoplay();
            }
        }

        // Keyboard navigation
        gallery.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                goTo(currentIndex - 1);
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                goTo(currentIndex + 1);
            }
        });

        // Touch/swipe support
        let touchStartX = 0;
        let touchStartY = 0;
        let isSwiping = false;

        main.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            isSwiping = true;
        }, { passive: true });

        main.addEventListener('touchmove', (e) => {
            if (!isSwiping) return;
            const dx = e.touches[0].clientX - touchStartX;
            const dy = e.touches[0].clientY - touchStartY;
            // Only handle horizontal swipes
            if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
                e.preventDefault();
            }
        }, { passive: false });

        main.addEventListener('touchend', (e) => {
            if (!isSwiping) return;
            isSwiping = false;
            const dx = e.changedTouches[0].clientX - touchStartX;
            if (Math.abs(dx) > 50) {
                if (dx < 0) goTo(currentIndex + 1);
                else goTo(currentIndex - 1);
            }
        }, { passive: true });

        // Autoplay
        function startAutoplay() {
            autoplayTimer = setInterval(() => {
                goTo(currentIndex + 1);
            }, opts.interval);
        }

        if (opts.autoplay && images.length > 1) {
            startAutoplay();
        }

        // Pause autoplay on hover
        gallery.addEventListener('mouseenter', () => {
            if (autoplayTimer) clearInterval(autoplayTimer);
        });
        gallery.addEventListener('mouseleave', () => {
            if (opts.autoplay && images.length > 1) startAutoplay();
        });
    }
};
