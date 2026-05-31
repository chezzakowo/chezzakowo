// scripts/404.js — 404 page logic
// Handles: background, text animation, audio player, footer, theme

// ── Constants ─────────────────────────────────────────────────────────────────

const LABEL_INTERVAL_MS = 10000;
const FADE_DURATION_MS  = 400;

const LABELS = {
  vi: {
    label:  'Server hiện không khả dụng.',
    hint:   'Hiện tại bên host của mình đi nghỉ dưỡng rồi nên là server đang không khả dụng. Có gì quay lại sau nhé! Trạng thái server tại: https://status.chezzakowo.qzz.io',
  },
  en: {
    label:  'Server Unavailable',
    hint:   'The server is currently unavailable. Please try again later. Server status can be checked at: https://status.chezzakowo.qzz.io',
    back:   'Back to homepage',
  },
};

// ── State ─────────────────────────────────────────────────────────────────────

let currentLang   = 'vi';
let labelInterval = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────

const audio          = /** @type {HTMLAudioElement} */ (document.getElementById('bgm'));
const btnPlay        = document.getElementById('btn-play');
const iconPlay       = document.getElementById('icon-play');
const iconPause      = document.getElementById('icon-pause');
const btnLoop        = document.getElementById('btn-loop');
const volSlider      = /** @type {HTMLInputElement} */ (document.getElementById('vol-slider'));
const volPct         = document.getElementById('player-vol-pct');
const playerNote     = document.querySelector('.player-note');
const playerFallback = document.getElementById('player-fallback');
const btnClickPlay   = document.getElementById('btn-click-play');
const errLabel       = document.getElementById('err-label');
const errHintText    = document.getElementById('err-hint-text');
const errBackLabel   = document.getElementById('err-back-label');
const footerCopy     = document.getElementById('footer-copy');

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.dataset.theme = savedTheme;

  const noise = document.createElement('div');
  noise.className = 'noise';
  document.body.appendChild(noise);

  // FIX: Fetch config dùng đường dẫn tuyệt đối từ web root
  // Dù 404.html được serve ở bất kỳ URL nào (/web/styles, /abc, ...),
  // /config/site.json luôn resolve đúng về web/config/site.json
  await loadSiteConfig();

  startLabelCycle();
  setupAudio();
}

// ── Site Config ───────────────────────────────────────────────────────────────

async function loadSiteConfig() {
  try {
    // FIX: Dùng absolute path /config/site.json thay vì relative 'config/site.json'
    // Relative path bị ảnh hưởng bởi URL hiện tại:
    //   URL: /web/styles  → resolve thành /web/config/site.json  ✗
    //   URL: /abc         → resolve thành /config/site.json      ✓
    // Absolute path luôn đúng bất kể URL hiện tại là gì.
    const res = await fetch('./config/site.json');
    if (!res.ok) throw new Error('site.json not found');
    const site = await res.json();

    if (site.background?.files?.length) {
      const folder = (site.background.folder || './assets/background/')

      const files = site.background.files;
      const file  = site.background.mode === 'random'
        ? files[Math.floor(Math.random() * files.length)]
        : files[0];

      // FIX: Build URL tuyệt đối thay vì dùng window.location làm base
      const absUrl = folder.replace(/\/$/, '') + '/' + file;

      document.body.style.backgroundImage      = `url('${absUrl}')`;
      document.body.style.backgroundSize       = 'cover';
      document.body.style.backgroundPosition   = 'center';
      document.body.style.backgroundRepeat     = 'no-repeat';
      document.body.style.backgroundAttachment = 'fixed';

      try {
        const credRes = await fetch('./config/background_credits.json');
        if (credRes.ok) {
          const credits = await credRes.json();
          updateFooter(site, credits[file] || null);
        } else {
          updateFooter(site, null);
        }
      } catch {
        updateFooter(site, null);
      }
    } else {
      updateFooter(site, null);
    }
  } catch (e) {
    console.warn('[404] Could not load site.json:', e.message);
  }
}

// ── Footer ────────────────────────────────────────────────────────────────────

function updateFooter(site, bgCredit) {
  if (!footerCopy) return;
  const copyright = site.site_footer || site.copyright || '© 2025';
  footerCopy.textContent = bgCredit
    ? `${copyright} · Background by ${bgCredit}`
    : copyright;
}

// ── Label Cycle (VI ↔ EN) ─────────────────────────────────────────────────────

function startLabelCycle() {
  setLabels(currentLang, false);

  labelInterval = setInterval(() => {
    currentLang = currentLang === 'vi' ? 'en' : 'vi';
    setLabels(currentLang, true);
  }, LABEL_INTERVAL_MS);
}

function setLabels(lang, fade) {
  const { label, hint, back } = LABELS[lang];

  if (!fade) {
    if (errLabel)     errLabel.textContent     = label;
    if (errHintText)  errHintText.textContent  = hint;
    if (errBackLabel) errBackLabel.textContent = back;
    return;
  }

  if (errLabel) errLabel.classList.add('fading');

  setTimeout(() => {
    if (errLabel)     errLabel.textContent     = label;
    if (errHintText)  errHintText.textContent  = hint;
    if (errBackLabel) errBackLabel.textContent = back;
    if (errLabel) errLabel.classList.remove('fading');
  }, FADE_DURATION_MS);
}

// ── Audio ─────────────────────────────────────────────────────────────────────
//
// Chiến lược autoplay:
//   1. <audio autoplay muted> → browser LUÔN cho phép play khi muted.
//   2. Sau 1 giây → unmute + ramp volume 0 → TARGET_VOL (fade in, tránh pop).
//   3. Nếu browser chặn cả muted play → hiện fallback button.
//   4. Tương tác đầu tiên của user (click/keydown bất kỳ đâu) → unmute ngay.

function setupAudio() {
  if (!audio) return;

  const TARGET_VOL = 0.5;
  let   unmuted    = false; // track xem đã unmute chưa

  // Sync slider UI
  if (volSlider) {
    volSlider.value = String(Math.round(TARGET_VOL * 100));
    updateSliderFill(Math.round(TARGET_VOL * 100));
  }
  if (volPct) volPct.textContent = `${Math.round(TARGET_VOL * 100)}%`;

  /**
   * Ramp volume từ 0 → target trong ~600ms (30 steps × 20ms).
   * Tránh audio pop khi unmute đột ngột.
   */
  function rampVolume(target = TARGET_VOL) {
    audio.volume = 0;
    let step = 0;
    const id = setInterval(() => {
      step++;
      audio.volume = Math.min(target, (step / 30) * target);
      if (step >= 30) clearInterval(id);
    }, 20);
  }

  /**
   * Unmute audio (chỉ chạy 1 lần).
   * Gọi được từ: setTimeout 1s, tương tác user, hoặc nút fallback.
   */
  function unmute() {
    if (unmuted) return;
    unmuted = true;

    audio.muted = false;
    rampVolume();
    setPlayingUI(true);
    if (playerFallback) playerFallback.style.display = 'none';
  }

  /**
   * Bắt đầu phát audio (muted), sau đó unmute sau 1 giây.
   * Nếu play() thất bại → hiện fallback.
   */
  function startPlayback() {
    audio.muted  = true;
    audio.volume = 0;

    audio.play()
      .then(() => {
        setPlayingUI(true);
        // Unmute sau 1 giây
        setTimeout(unmute, 1000);
      })
      .catch(() => {
        // Autoplay bị chặn hoàn toàn → hiện nút
        setPlayingUI(false);
        if (playerFallback) playerFallback.style.display = '';
      });
  }

  // ── Tương tác đầu tiên → unmute ngay (nếu đang play muted) ──
  // Áp dụng cho: click, keydown, scroll, touch bất kỳ đâu trên trang.
  function onFirstInteraction() {
    document.removeEventListener('click',     onFirstInteraction, { capture: true });
    document.removeEventListener('keydown',   onFirstInteraction, { capture: true });
    document.removeEventListener('touchstart',onFirstInteraction, { capture: true });
    document.removeEventListener('scroll',    onFirstInteraction, { capture: true });

    if (!audio.paused) {
      unmute();
    } else {
      // Chưa play được → thử play rồi unmute
      audio.play().then(unmute).catch(() => {});
    }
  }

  document.addEventListener('click',      onFirstInteraction, { capture: true, once: true });
  document.addEventListener('keydown',    onFirstInteraction, { capture: true, once: true });
  document.addEventListener('touchstart', onFirstInteraction, { capture: true, once: true });
  document.addEventListener('scroll',     onFirstInteraction, { capture: true, once: true });

  // ── Khởi động playback ──
  if (!audio.paused) {
    // <audio autoplay muted> đã tự play (một số browser)
    setPlayingUI(true);
    setTimeout(unmute, 1000);
  } else {
    // Chưa play → startPlayback()
    // Thử ngay, nếu fail thử lại sau 800ms (safety net)
    const guard = setTimeout(() => startPlayback(), 800);

    audio.addEventListener('play', () => {
      clearTimeout(guard);
      setPlayingUI(true);
      setTimeout(unmute, 1000);
    }, { once: true });

    startPlayback();
  }

  // ── Controls ──────────────────────────────────────────────────────────────

  if (btnPlay) btnPlay.addEventListener('click', togglePlayPause);

  // Nút fallback "Bỏ tắt tiếng"
  if (btnClickPlay) {
    btnClickPlay.addEventListener('click', () => {
      if (audio.paused) {
        audio.muted = true;
        audio.play()
          .then(() => {
            setPlayingUI(true);
            unmute();
            if (playerFallback) playerFallback.style.display = 'none';
          })
          .catch(console.warn);
      } else {
        unmute();
        if (playerFallback) playerFallback.style.display = 'none';
      }
    });
  }

  if (volSlider) {
    volSlider.addEventListener('input', () => {
      const val    = Number(volSlider.value);
      audio.muted  = false;
      audio.volume = val / 100;
      unmuted      = true;
      updateSliderFill(val);
      if (volPct) volPct.textContent = `${val}%`;
    });
  }

  if (btnLoop) {
    btnLoop.addEventListener('click', () => {
      audio.loop = !audio.loop;
      btnLoop.classList.toggle('active', audio.loop);
      btnLoop.setAttribute('aria-pressed', String(audio.loop));
    });
  }

  audio.addEventListener('ended', () => { if (!audio.loop) setPlayingUI(false); });
  audio.addEventListener('pause', () => setPlayingUI(false));
  audio.addEventListener('play',  () => setPlayingUI(true));
}

function togglePlayPause() {
  if (!audio) return;
  if (audio.paused) {
    audio.play().then(() => setPlayingUI(true)).catch(console.warn);
  } else {
    audio.pause();
    setPlayingUI(false);
  }
}

function setPlayingUI(isPlaying) {
  if (iconPlay)   iconPlay.style.display   = isPlaying ? 'none' : '';
  if (iconPause)  iconPause.style.display  = isPlaying ? ''     : 'none';
  if (playerNote) playerNote.classList.toggle('paused', !isPlaying);
}

function updateSliderFill(value) {
  if (volSlider) volSlider.style.setProperty('--val', `${value}%`);
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

window.addEventListener('beforeunload', () => {
  if (labelInterval !== null) {
    clearInterval(labelInterval);
    labelInterval = null;
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────

init().catch(err => {
  console.error('[404] Init error:', err);
});
