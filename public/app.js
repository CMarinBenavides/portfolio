/**
 * Lógica de la página del portafolio (se ejecuta en el navegador del visitante).
 *
 * Se encarga de:
 *   - Pedir al servidor los datos del perfil y la lista de fotos, y pintarlos.
 *   - Abrir las fotos en grande (visor) y pasar de una a otra.
 *   - El menú de las iniciales y el modo edición (subir, borrar y elegir portada).
 *   - Cambiar entre modo claro y oscuro.
 *
 * Las fotos vienen del servidor con dos direcciones ya preparadas por Cloudinary:
 *   - image.thumb → versión mediana, para la galería (carga rápido).
 *   - image.full  → versión grande, para el visor y la portada.
 */

// Atajo para buscar un elemento de la página: $('#name') equivale a
// document.querySelector('#name').
const $ = (sel) => document.querySelector(sel);

// Iconos de las redes sociales, como trazados SVG (el "dibujo" del logo).
// La clave es el nombre de la red en minúsculas, tal como aparece en config.json.
const ICONS = {
  instagram: 'M12 2.2c3.2 0 3.6 0 4.8.1 3.3.1 4.8 1.7 4.9 4.9.1 1.3.1 1.6.1 4.8s0 3.6-.1 4.8c-.1 3.2-1.7 4.8-4.9 4.9-1.3.1-1.6.1-4.8.1s-3.6 0-4.8-.1c-3.3-.1-4.8-1.7-4.9-4.9C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.8C2.4 3.9 3.9 2.4 7.2 2.3 8.4 2.2 8.8 2.2 12 2.2zm0 4.7a5.1 5.1 0 100 10.2 5.1 5.1 0 000-10.2zm0 8.4a3.3 3.3 0 110-6.6 3.3 3.3 0 010 6.6zm5.3-9.8a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4z',
  x: 'M18.2 2.3h3.4l-7.4 8.4 8.7 11.5h-6.8l-5.3-7-6.1 7H1.3l7.9-9L.8 2.3h7l4.8 6.4 5.6-6.4zm-1.2 17.9h1.9L7 4.2H5z',
  facebook: 'M24 12a12 12 0 10-13.9 11.9v-8.4h-3V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0024 12z',
  tiktok: 'M19.6 6.7a4.8 4.8 0 01-3.8-4.2V2h-3.4v13.7a2.9 2.9 0 11-2-2.7V9.5a6.3 6.3 0 105.4 6.2V8.8a8.2 8.2 0 004.8 1.5V6.9a4.8 4.8 0 01-1-.2z',
};

// --- Estado de la página ---
// Contraseña del modo edición. Se guarda en sessionStorage para no pedirla en
// cada recarga; se borra sola al cerrar la pestaña.
let adminPassword = sessionStorage.getItem('adminPassword');
let images = []; // lista de fotos recibida del servidor
let lightboxItems = []; // fotos que se recorren en el visor (galería o un shooting)
let current = 0; // posición de la foto abierta en el visor
let shootingsCount = 0; // cuántos shootings hay (solo se permite uno)
let editingShooting = null; // shooting que se está editando (null = publicar uno nuevo)
let profileName = ''; // nombre de pila, se usa como cabecera de la "revista"
let profileFullName = ''; // nombre completo, va en la cabecera de las hojas de eventos
let configReady; // Promise que se cumple cuando se han cargado los datos del perfil
let googleConfig = null; // claves públicas de Google Drive (null = no configurado)

/**
 * Crea un elemento HTML de forma segura.
 *   el('a', { href: '...', text: 'Hola' }, [hijo1, hijo2])
 * El atributo especial "text" asigna el texto con textContent, que nunca
 * interpreta HTML: así un título con "<script>" se muestra como texto y no se ejecuta.
 */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => (k === 'text' ? (node.textContent = v) : node.setAttribute(k, v)));
  node.append(...children);
  return node;
}

// ---------------------------------------------------------------------------
// Perfil: nombre, lema, medidas, biografía y contacto
// ---------------------------------------------------------------------------

// Crea el enlace de una red social con su icono (si lo tenemos) y su nombre.
function socialLink({ name, url }) {
  const a = el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' });
  const path = ICONS[name.toLowerCase()];
  if (path) {
    a.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
  }
  a.append(name);
  return a;
}

/**
 * Dibuja el icono de la pestaña del navegador (favicon): un círculo oscuro con
 * las iniciales en color marfil y letra serif cursiva, como el monograma de la
 * barra superior. Se crea como imagen SVG dentro de una dirección "data:", así
 * que no hace falta ningún archivo de imagen aparte.
 * (El favicon no puede cargar las fuentes de Google, por eso usa Georgia,
 * una serif que viene instalada en casi todos los sistemas.)
 */
function setFavicon(initials) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <circle cx="32" cy="32" r="32" fill="#141210"/>
    <text x="32" y="41" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif"
      font-style="italic" font-size="${initials.length > 2 ? 20 : 26}" fill="#f5f1eb">${initials}</text>
  </svg>`;
  $('#favicon').href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// Pide al servidor los datos de data/config.json y los coloca en la página.
async function loadConfig() {
  const config = await fetch('/api/config').then((r) => r.json());
  document.title = config.name;
  profileName = config.name.trim().split(/\s+/)[0]; // p. ej. "Lyda"
  profileFullName = config.name.trim();

  // El nombre se reparte en dos líneas (nombres / apellidos); la segunda va en
  // cursiva gracias al CSS. Las iniciales del menú salen de la primera letra de cada línea.
  const words = config.name.trim().split(/\s+/);
  const half = Math.ceil(words.length / 2);
  const lines = [words.slice(0, half), words.slice(half)].filter((line) => line.length);
  $('#name').replaceChildren(...lines.map((line) => el('span', { text: line.join(' ') })));
  const initials = lines.map((line) => line[0][0]).join('');
  $('#monogram').textContent = initials;
  setFavicon(initials);

  $('#tagline').textContent = config.tagline || '';
  $('#location').textContent = config.location || '';
  $('#bio').textContent = config.bio || '';
  $('#footer-name').textContent = config.name;
  $('#social').replaceChildren(...config.social.map(socialLink));

  // Ficha de medidas: cada par "Altura": "175 cm" se convierte en una columna.
  // Si no hay medidas en config.json, la sección se oculta.
  const stats = Object.entries(config.stats || {});
  $('.stats').classList.toggle('hidden', stats.length === 0);
  $('#stats').replaceChildren(...stats.map(([label, value]) =>
    el('div', {}, [el('dt', { text: label }), el('dd', { text: value })])));

  // El correo y el botón de GitHub solo se muestran si están en config.json.
  if (config.email) {
    $('#email').href = `mailto:${config.email}`;
    $('#email').textContent = config.email;
    $('#email').classList.remove('hidden');
  }

  if (config.github) {
    $('#github-link').href = config.github;
    $('#github-link').classList.remove('hidden');
  }

  // Botones "Desde Google Drive": solo si el servidor tiene las claves de Google.
  googleConfig = config.google;
  document.querySelectorAll('.drive-btn').forEach((btn) => btn.classList.toggle('hidden', !googleConfig));
  if (googleConfig && adminPassword) loadGoogle().catch(() => {}); // precarga (ver loadGoogle)
}

// ---------------------------------------------------------------------------
// Galería y portada
// ---------------------------------------------------------------------------

// Pide la lista de fotos y vuelve a pintar la galería y la portada.
async function loadImages() {
  images = await fetch('/api/images').then((r) => r.json());

  // La portada es la elegida en modo edición o, si no hay ninguna, la foto más
  // antigua (la última de la lista, porque vienen de la más nueva a la más vieja).
  const cover = images.find((img) => img.cover) || images.at(-1);

  $('#empty').classList.toggle('hidden', images.length > 0);
  $('#gallery').replaceChildren(...images.map((image) => card(image, image === cover)));

  renderHero(cover);
}

// ---------------------------------------------------------------------------
// Encuadre de imágenes (foto principal del inicio y tarjetas de eventos)
// ---------------------------------------------------------------------------
// La imagen llena su marco recortándose (object-fit: cover en el CSS). El
// "encuadre" decide qué parte se ve: es el punto de la imagen, en porcentajes,
// que queda en el centro (50%, 50% = el centro de la imagen). Se aplica con la
// propiedad CSS object-position y se guarda en Cloudinary junto a la imagen.
let heroCover = null; // foto que se muestra ahora como principal

// El zoom se aplica con la propiedad CSS "scale", tomando como centro el
// mismo punto del encuadre (transform-origin). Usamos "scale" y no
// "transform" para que no choque con las animaciones y el efecto al pasar el
// ratón, que usan "transform". Como la foto ya cubre todo el marco, al
// ampliarla sigue cubriéndolo: nunca quedan huecos.
const ZOOM_MAX = 3;
const applyFocus = (img, focus) => {
  const { x = 50, y = 50, zoom = 1 } = focus || {};
  img.style.objectPosition = `${x}% ${y}%`;
  img.style.transformOrigin = `${x}% ${y}%`;
  img.style.scale = zoom === 1 ? '' : String(zoom);
};

// Pinta la foto principal. En modo edición añade el botón "Ajustar encuadre".
function renderHero(cover) {
  heroCover = cover;
  const frame = $('#hero-image');
  if (!cover) {
    frame.replaceChildren(el('span', { class: 'placeholder', text: 'Tu foto principal aparecerá aquí' }));
    return;
  }
  // draggable="false" evita que el navegador intente arrastrar la imagen como archivo.
  const img = el('img', { src: cover.full, alt: cover.title || '', draggable: 'false' });
  applyFocus(img, cover.focus);
  frame.replaceChildren(img);
  if (adminPassword) frame.append(adjustButton(adjustHero));
}

// Abre el modo de ajuste para la foto principal.
const adjustHero = () => startAdjust({ frame: $('#hero-image'), item: heroCover, endpoint: '/api/images' });

// Botón "Ajustar encuadre" que se coloca sobre una imagen en modo edición.
function adjustButton(onClick) {
  const button = el('button', { class: 'adjust-btn', text: 'Ajustar encuadre' });
  button.addEventListener('click', (e) => {
    e.stopPropagation(); // que el clic no active nada más de la tarjeta
    onClick();
  });
  return button;
}

/**
 * Modo de ajuste: se arrastra la imagen (con el ratón o con el dedo) para
 * decidir qué parte se ve, y luego se guarda o se cancela.
 *   frame    → el marco que recorta la imagen (contiene el <img>)
 *   item     → la foto o el evento (con su id y su encuadre actual)
 *   endpoint → dónde se guarda: '/api/images' o '/api/events'
 */
function startAdjust({ frame, item, endpoint }) {
  const img = frame.querySelector('img');
  if (!img || !item || frame.classList.contains('adjusting')) return;

  const original = { x: 50, y: 50, zoom: 1, ...item.focus };
  const focus = { ...original };
  let drag = null; // datos del arrastre en curso

  // Todos los eventos de este modo se registran con la misma "señal": al
  // terminar, controller.abort() los quita todos de una vez.
  const controller = new AbortController();
  const { signal } = controller;

  frame.classList.add('adjusting');
  // Mientras se ajusta, ocultamos los botones flotantes (GitHub y volver arriba)
  // para que no tapen los botones Guardar / Cancelar.
  document.body.classList.add('hero-adjusting');
  const save = el('button', { class: 'btn', text: 'Guardar' });
  const cancel = el('button', { class: 'btn btn-outline', text: 'Cancelar' });
  // Control del zoom: una barra deslizante de 1× a 3×, con lupas a los lados.
  const zoomInput = el('input', {
    type: 'range', min: '1', max: String(ZOOM_MAX), step: '0.01',
    value: String(focus.zoom), 'aria-label': 'Zoom',
  });
  const zoomBox = el('label', { class: 'zoom-control', title: 'Zoom (también con la rueda del ratón)' }, [
    el('span', { text: '−', 'aria-hidden': 'true' }),
    zoomInput,
    el('span', { text: '+', 'aria-hidden': 'true' }),
  ]);
  const bar = el('div', { class: 'adjust-bar' }, [
    el('p', { text: 'Arrastra la foto para encuadrarla y usa el zoom para acercarla' }),
    zoomBox,
    el('div', { class: 'form-actions' }, [save, cancel]),
  ]);
  frame.append(bar);

  const setZoom = (value) => {
    focus.zoom = Math.min(ZOOM_MAX, Math.max(1, Math.round(value * 100) / 100));
    zoomInput.value = String(focus.zoom);
    applyFocus(img, focus);
  };
  zoomInput.addEventListener('input', () => setZoom(Number(zoomInput.value)), { signal });
  // La rueda del ratón (o el gesto de pellizco del touchpad) sobre la foto también hace zoom.
  // passive: false permite usar preventDefault para que la página no se desplace a la vez.
  img.addEventListener('wheel', (e) => {
    e.preventDefault();
    setZoom(focus.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
  }, { signal, passive: false });

  // Pointer Events funcionan igual con ratón, dedo o lápiz.
  img.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    // Seguimos recibiendo el movimiento aunque el puntero salga de la foto.
    // (Si el navegador no lo permite, el arrastre funciona igual dentro de la foto.)
    try { img.setPointerCapture(e.pointerId); } catch {}
    // Cuánto "sobra" de la foto por cada lado: es lo que se puede desplazar.
    // La foto se escala hasta cubrir el marco, así que sobra en ancho o en
    // alto; con zoom, sobra además por los dos lados.
    const scale = Math.max(frame.clientWidth / img.naturalWidth, frame.clientHeight / img.naturalHeight) * focus.zoom;
    drag = {
      startX: e.clientX,
      startY: e.clientY,
      from: { ...focus },
      spareX: img.naturalWidth * scale - frame.clientWidth,
      spareY: img.naturalHeight * scale - frame.clientHeight,
    };
  }, { signal });

  img.addEventListener('pointermove', (e) => {
    if (!drag) return;
    // Arrastrar hacia la derecha muestra más de la parte izquierda de la foto,
    // por eso se resta. Convertimos los píxeles movidos en porcentaje de lo que sobra.
    const clamp = (n) => Math.min(100, Math.max(0, n));
    if (drag.spareX > 0) focus.x = clamp(drag.from.x - ((e.clientX - drag.startX) / drag.spareX) * 100);
    if (drag.spareY > 0) focus.y = clamp(drag.from.y - ((e.clientY - drag.startY) / drag.spareY) * 100);
    applyFocus(img, focus);
  }, { signal });

  const endDrag = () => (drag = null);
  img.addEventListener('pointerup', endDrag, { signal });
  img.addEventListener('pointercancel', endDrag, { signal });

  function finish() {
    controller.abort();
    frame.classList.remove('adjusting');
    document.body.classList.remove('hero-adjusting');
    bar.remove();
  }

  cancel.addEventListener('click', () => {
    applyFocus(img, original);
    finish();
  }, { signal });

  // Esc también cancela.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cancel.click();
  }, { signal });

  save.addEventListener('click', async () => {
    save.disabled = true;
    const res = await fetch(`${endpoint}/${item.id}/focus`, {
      method: 'PUT',
      headers: { 'x-admin-password': adminPassword, 'Content-Type': 'application/json' },
      body: JSON.stringify(focus),
    });
    if (!res.ok) {
      save.disabled = false;
      alert((await res.json()).error);
      return;
    }
    item.focus = (await res.json()).focus;
    finish();
  }, { signal });
}

// Crea la tarjeta de una foto de la galería. En modo edición le añade los
// botones de borrar, de editar sus textos y de elegir como portada.
function card(image, isCover) {
  // loading="lazy": el navegador solo descarga la foto cuando está a punto de
  // verse al hacer scroll, así la página carga antes.
  const img = el('img', { src: image.thumb, alt: image.title || 'Imagen del portafolio', loading: 'lazy' });
  const figure = el('figure', { class: 'card', tabindex: '0' }, [img]);
  if (image.title) figure.append(el('figcaption', { text: image.title }));

  if (adminPassword) {
    const del = el('button', { class: 'delete', 'aria-label': 'Eliminar imagen', text: '×' });
    del.addEventListener('click', (e) => {
      e.stopPropagation(); // evita que el clic abra también el visor
      deleteImage(image);
    });

    const coverBtn = el('button', {
      class: `cover-btn${isCover ? ' is-cover' : ''}`,
      text: isCover ? '★ Portada' : '☆ Usar como portada',
    });
    if (isCover) coverBtn.disabled = true;
    coverBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setCover(image);
    });

    const edit = editButton(() => editTexts({ endpoint: '/api/images', item: image, reload: loadImages }));
    figure.append(del, edit, coverBtn);
  }

  // Clic o tecla Enter sobre la foto → abrirla en el visor.
  const open = () => openLightbox(images, images.indexOf(image));
  figure.addEventListener('click', open);
  figure.addEventListener('keydown', (e) => e.key === 'Enter' && open());
  return figure;
}

// ---------------------------------------------------------------------------
// Editar el título y la descripción de una foto de la galería
// ---------------------------------------------------------------------------

const PENCIL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/></svg>';

// Botón con un lápiz que se coloca junto al de borrar (solo en modo edición).
function editButton(onClick) {
  const button = el('button', { class: 'edit-text', 'aria-label': 'Editar título y descripción', title: 'Editar textos' });
  button.innerHTML = PENCIL;
  button.addEventListener('click', (e) => {
    e.stopPropagation(); // evita que el clic abra también el visor
    onClick();
  });
  return button;
}

let textTarget = null; // { endpoint, item, reload }: lo que se está editando

/**
 * Abre la ventana de edición con los textos actuales.
 *   endpoint → dónde se guarda ('/api/images')
 *   item     → la foto
 *   reload   → función que vuelve a pintar la sección al guardar
 * (Los eventos se editan con su propio formulario, más completo.)
 */
function editTexts({ endpoint, item, reload }) {
  const form = $('#text-form');
  textTarget = { endpoint, item, reload };
  form.elements.title.value = item.title || '';
  form.elements.description.value = item.description || '';
  form.querySelector('.msg').textContent = '';
  $('#text-editor').showModal();
  form.elements.title.focus();
}

$('#text-cancel').addEventListener('click', () => $('#text-editor').close());

$('#text-form').addEventListener('submit', async (e) => {
  e.preventDefault(); // cerramos la ventana nosotros, solo si se guarda bien
  const form = e.target;
  const msg = form.querySelector('.msg');
  const submit = form.querySelector('button[type=submit]');
  const { endpoint, item, reload } = textTarget;

  submit.disabled = true;
  msg.className = 'msg';
  msg.textContent = 'Guardando…';
  const res = await fetch(`${endpoint}/${item.id}`, {
    method: 'PUT',
    headers: { 'x-admin-password': adminPassword, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: form.elements.title.value, description: form.elements.description.value }),
  });
  submit.disabled = false;

  if (!res.ok) {
    msg.className = 'msg error';
    msg.textContent = (await res.json()).error;
    if (res.status === 401) {
      $('#text-editor').close();
      setAdmin(null); // la contraseña cambió: salimos del modo edición
    }
    return;
  }
  $('#text-editor').close();
  reload();
});

// ---------------------------------------------------------------------------
// Visor de fotos a pantalla completa
// ---------------------------------------------------------------------------

// Abre el visor con una lista de fotos (la galería, o las 5 de un shooting)
// empezando por la foto en la posición "index".
function openLightbox(list, index) {
  lightboxItems = list;
  showLightbox(index);
}

// Muestra la foto en la posición "index". El cálculo con % hace que, al pasar
// de la última, se vuelva a la primera (y al revés).
function showLightbox(index) {
  current = (index + lightboxItems.length) % lightboxItems.length;
  const image = lightboxItems[current];
  $('#lightbox-img').src = image.full;
  $('#lightbox-img').alt = image.title || '';
  $('#lightbox-title').textContent = image.title;
  $('#lightbox-desc').textContent = image.description;
  if (!$('#lightbox').open) $('#lightbox').showModal();
}

// Flechas ‹ › para cambiar de foto; clic en cualquier otro sitio (salvo la
// propia foto) para cerrar. La tecla Esc la cierra el navegador automáticamente.
$('#lightbox').addEventListener('click', (e) => {
  if (e.target.classList.contains('prev')) showLightbox(current - 1);
  else if (e.target.classList.contains('next')) showLightbox(current + 1);
  else if (e.target.tagName !== 'IMG') $('#lightbox').close();
});
$('#lightbox').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') showLightbox(current - 1);
  if (e.key === 'ArrowRight') showLightbox(current + 1);
});

// ---------------------------------------------------------------------------
// Acciones del modo edición (todas envían la contraseña al servidor)
// ---------------------------------------------------------------------------

async function setCover(image) {
  const res = await fetch(`/api/images/${image.id}/cover`, {
    method: 'PUT',
    headers: { 'x-admin-password': adminPassword },
  });
  if (!res.ok) {
    alert((await res.json()).error);
    return loadImages();
  }
  // Nueva portada elegida: subimos al inicio y entramos directamente en el
  // modo de ajuste para encuadrarla.
  await loadImages();
  window.scrollTo({ top: 0 });
  adjustHero();
}

// Borra una foto, un evento, una polaroid o un shooting tras pedir confirmación.
//   endpoint → '/api/images', '/api/events', '/api/polaroids' o '/api/shootings'
//   reload   → función que vuelve a pintar la sección correspondiente
async function deleteItem(endpoint, item, reload) {
  if (!confirm(`¿Eliminar "${item.title || 'esta imagen'}"?`)) return;
  const res = await fetch(`${endpoint}/${item.id}`, {
    method: 'DELETE',
    headers: { 'x-admin-password': adminPassword },
  });
  if (!res.ok) alert((await res.json()).error);
  reload();
}

const deleteImage = (image) => deleteItem('/api/images', image, loadImages);

// Activa (con contraseña) o desactiva (con null) el modo edición.
function setAdmin(password) {
  adminPassword = password;
  if (password) sessionStorage.setItem('adminPassword', password);
  else sessionStorage.removeItem('adminPassword');
  $('#upload-form').classList.toggle('hidden', !password);
  // Botones "+ Añadir…" de Eventos y Shootings (y cerrar sus formularios al salir).
  $('#add-event-btn').classList.toggle('hidden', !password);
  if (!password) {
    toggleEventForm(false);
    togglePolaroidForm(false);
    toggleShootingForm(false);
  }
  $('#admin-btn').textContent = password ? 'Salir de edición' : 'Editar';
  // Repinta las secciones para mostrar u ocultar los botones de edición.
  loadImages();
  loadEvents();
  loadPolaroids();
  loadShootings();
  // Al entrar en modo edición, precargamos las librerías de Google Drive (si está configurado).
  if (password && googleConfig) loadGoogle().catch(() => {});
}

// ---------------------------------------------------------------------------
// Menú desplegable de las iniciales
// ---------------------------------------------------------------------------

// Abre o cierra el menú. aria-expanded avisa a los lectores de pantalla (y al
// CSS, que gira la flechita) de si está abierto.
function toggleMenu(open) {
  $('#menu-list').hidden = !open;
  $('#menu-btn').setAttribute('aria-expanded', open);
}

$('#menu-btn').addEventListener('click', () => toggleMenu($('#menu-list').hidden));

// Se cierra al hacer clic fuera del menú o al pulsar Esc.
document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu')) toggleMenu(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#menu-list').hidden) {
    toggleMenu(false);
    $('#menu-btn').focus();
  }
});

// Opción "Editar" / "Salir de edición" del menú.
$('#admin-btn').addEventListener('click', async () => {
  toggleMenu(false);
  if (adminPassword) return setAdmin(null);
  const password = prompt('Contraseña de administrador:');
  if (!password) return;
  // Comprobamos la contraseña con el servidor antes de mostrar el formulario.
  const res = await fetch('/api/login', { method: 'POST', headers: { 'x-admin-password': password } });
  if (res.ok) setAdmin(password);
  else alert('Contraseña incorrecta');
});

// ---------------------------------------------------------------------------
// Formularios de subida (fotos de la galería y eventos)
// ---------------------------------------------------------------------------

/**
 * Prepara un formulario de subida. Los formularios de la página (fotos, eventos
 * y shootings) tienen la misma estructura, así que comparten este código:
 * vista previa de las imágenes, zonas para arrastrar archivos y envío al servidor.
 *
 *   form        → el elemento <form>
 *   endpoint    → a qué ruta de la API se envía ('/api/images', '/api/events'…).
 *                 También puede ser una función que devuelva { url, method },
 *                 para formularios que sirven para crear y para editar.
 *   successText → mensaje que se muestra al terminar (texto o función)
 *   onSuccess   → qué hacer después (normalmente, volver a pintar la sección)
 *   prepare     → (opcional) se llama justo antes de enviar con los datos del
 *                 formulario: puede añadir datos o devolver un texto de error
 *                 para cancelar el envío y mostrar ese aviso.
 */
function setupUploadForm(form, { endpoint, successText, onSuccess, prepare }) {
  const msg = form.querySelector('.msg');
  const submit = form.querySelector('button[type=submit]');

  // Cada zona de archivo (.dropzone) tiene su propia vista previa. El
  // formulario de shootings tiene dos: la portada y las 4 del collage.
  const zones = [...form.querySelectorAll('.dropzone')].map((dropzone) => {
    const input = dropzone.querySelector('input[type=file]');
    const previews = dropzone.querySelector('.previews');
    const dropText = dropzone.querySelector('.drop-text');
    // data-multiple-of="4" en el HTML: las imágenes deben ir de 4 en 4 (páginas
    // completas del collage). data-max: cuántas como máximo de una vez. Se lee
    // cada vez porque puede cambiar (en polaroids depende de los huecos libres).
    const multipleOf = Number(input.dataset.multipleOf) || 0;
    const getMax = () => Number(input.dataset.max) || (input.multiple ? 20 : 1);

    // Muestra miniaturas de las imágenes elegidas antes de subirlas.
    // URL.createObjectURL crea una dirección temporal que apunta al archivo local.
    function showPreview() {
      const files = [...input.files];
      previews.replaceChildren(...files.map((file) => el('img', { src: URL.createObjectURL(file), alt: '' })));
      previews.classList.toggle('multi', files.length > 1); // varias → cuadrícula
      dropText.classList.toggle('hidden', files.length > 0);

      // Si las imágenes deben ir de N en N (o hay un máximo), avisamos al
      // navegador cuando no se cumple: setCustomValidity impide enviar el
      // formulario y muestra el mensaje.
      const max = getMax();
      let problem = '';
      if (files.length > max) problem = `Puedes elegir como máximo ${max} imágenes de una vez (has elegido ${files.length}).`;
      else if (multipleOf && files.length % multipleOf) {
        problem = `Elige las imágenes de ${multipleOf} en ${multipleOf}: ${multipleOf}, ${multipleOf * 2}, ${multipleOf * 3}… (has elegido ${files.length}).`;
      }
      input.setCustomValidity(problem);
      if (problem) input.reportValidity();
      // Avisamos de que cambiaron los archivos (lo usa el formulario de eventos
      // para pedir la leyenda de cada foto). "change" no sirve: no se dispara
      // cuando las fotos llegan desde Google Drive ni al vaciar el formulario.
      input.dispatchEvent(new Event('fileschange'));
    }

    input.addEventListener('change', showPreview);

    // Resalta la zona al arrastrar archivos encima. Soltarlos funciona solo
    // porque el <input type="file"> transparente cubre toda la zona.
    ['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, () => dropzone.classList.add('dragover')));
    ['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, () => dropzone.classList.remove('dragover')));

    // Botón "Desde Google Drive" de esta zona: abre el selector de Google,
    // descarga las fotos elegidas y las coloca en el campo de archivo, como si
    // se hubieran elegido desde el computador. A partir de ahí, la vista previa,
    // las comprobaciones y el envío funcionan exactamente igual.
    const driveBtn = dropzone.parentElement.querySelector('.drive-btn');
    driveBtn?.addEventListener('click', async () => {
      msg.className = 'msg';
      msg.textContent = 'Abriendo Google Drive…';
      driveBtn.disabled = true;
      try {
        const files = await pickFromDrive({
          multiple: input.multiple,
          max: getMax(),
          onDownload: () => (msg.textContent = 'Descargando de Google Drive…'),
        });
        msg.textContent = '';
        if (!files.length) return; // se cerró el selector sin elegir nada
        // DataTransfer permite construir una lista de archivos y asignarla al campo.
        const list = new DataTransfer();
        files.forEach((file) => list.items.add(file));
        input.files = list.files;
        showPreview();
      } catch (error) {
        msg.className = 'msg error';
        msg.textContent = error.message;
      } finally {
        driveBtn.disabled = false;
        driveBtn.focus({ preventScroll: true }); // el foco vuelve al botón sin mover la página
      }
    });

    return { showPreview };
  });

  // Cuando se limpia el formulario (form.reset()), quitamos también las vistas
  // previas. El evento "reset" llega antes de que se vacíen los campos, por eso
  // esperamos un instante (setTimeout 0) antes de repintar.
  form.addEventListener('reset', () => {
    setTimeout(() => zones.forEach((zone) => zone.showPreview()));
    msg.textContent = '';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault(); // evita que el navegador recargue la página al enviar

    // FormData empaqueta la imagen, el título y la descripción tal como los espera el servidor.
    const data = new FormData(form);
    const problem = prepare?.(data);
    if (problem) {
      msg.className = 'msg error';
      msg.textContent = problem;
      return;
    }

    submit.disabled = true; // evita subir lo mismo dos veces por doble clic
    msg.className = 'msg';
    msg.textContent = 'Guardando…';
    const target = typeof endpoint === 'function' ? endpoint() : { url: endpoint, method: 'POST' };
    const res = await fetch(target.url, {
      method: target.method,
      headers: { 'x-admin-password': adminPassword },
      body: data,
    });
    submit.disabled = false;

    if (res.ok) {
      form.reset();
      msg.textContent = typeof successText === 'function' ? successText() : successText;
      onSuccess();
    } else {
      msg.className = 'msg error';
      msg.textContent = (await res.json()).error;
      if (res.status === 401) setAdmin(null); // la contraseña cambió: salimos del modo edición
    }
  });
}

setupUploadForm($('#upload-form'), {
  endpoint: '/api/images',
  successText: 'Fotografía subida',
  onSuccess: loadImages,
});

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

// Cada evento se muestra como una hoja de portafolio:
//   cabecera (nombre · PORTFOLIO · año) y el logo del evento (opcional),
//   título, fecha y detalle, 3 columnas de créditos,
//   y abajo de 1 a 3 fotos una al lado de otra, cada una con su leyenda.

const EVENT_MAX_PHOTOS = 3; // el mismo máximo que acepta el servidor

// Pide la lista de eventos y pinta las hojas.
async function loadEvents() {
  const [events] = await Promise.all([
    fetch('/api/events').then((r) => r.json()),
    configReady, // esperamos al nombre, que va en la cabecera de cada hoja
  ]);
  // La sección se ve siempre. Si no hay eventos, se muestra un aviso: para los
  // visitantes, un texto sencillo; en modo edición, una indicación de cómo añadir uno.
  $('#events-empty').textContent = adminPassword
    ? 'Aún no hay eventos. Pulsa «+ Añadir evento» para publicar el primero.'
    : 'No hay eventos registrados.';
  $('#events-empty').classList.toggle('hidden', events.length > 0);
  $('#events-list').replaceChildren(...events.map(eventSheet));
}

// Crea la hoja de un evento.
function eventSheet(event) {
  const credits = event.credits.filter((c) => c.label || c.value);
  const heading = el('div', { class: 'sheet-heading' }, [
    el('h3', { text: event.title }),
    ...(event.date ? [el('p', { class: 'sheet-date', text: event.date })] : []),
    ...(event.detail ? [el('p', { class: 'sheet-detail', text: event.detail })] : []),
  ]);
  const head = el('div', { class: 'sheet-head' }, [heading]);
  if (event.logo) {
    head.append(el('img', { class: 'sheet-logo', src: event.logo.thumb, alt: `Logo de ${event.title}`, loading: 'lazy' }));
  }

  const sheet = el('article', { class: 'event-sheet' }, [
    el('header', { class: 'sheet-top' }, [
      el('span', {}, [el('strong', { text: profileFullName }), el('span', { text: 'Portfolio' })]),
      el('span', { text: String(new Date().getFullYear()) }),
    ]),
    head,
  ]);
  if (credits.length) {
    sheet.append(el('dl', { class: 'sheet-credits' }, credits.map((c) =>
      el('div', {}, [el('dt', { text: c.label }), el('dd', { text: c.value })]))));
  }
  if (event.description) sheet.append(el('p', { class: 'sheet-desc', text: event.description }));

  // Fotos: tantas columnas como fotos (1, 2 o 3). En el visor se ven con su leyenda.
  const viewerItems = event.images.map((img) => ({ ...img, title: img.legend, description: img.place }));
  sheet.append(el('div', { class: `sheet-photos count-${event.images.length}` },
    event.images.map((image, i) => sheetPhoto(event, image, () => openLightbox(viewerItems, i)))));

  if (adminPassword) {
    const edit = el('button', { class: 'btn btn-outline sheet-edit', text: 'Editar' });
    edit.addEventListener('click', () => toggleEventForm(true, event));
    const del = el('button', { class: 'btn btn-outline sheet-delete', text: 'Eliminar' });
    del.addEventListener('click', () => deleteItem('/api/events', event, loadEvents));
    sheet.append(el('div', { class: 'sheet-admin' }, [edit, del]));
  }
  return sheet;
}

// Una foto de la hoja, con su leyenda encima (abajo a la izquierda).
function sheetPhoto(event, image, open) {
  const img = el('img', { src: image.thumb, alt: image.legend || event.title, loading: 'lazy', draggable: 'false' });
  applyFocus(img, image.focus); // encuadre guardado (qué parte de la foto se ve)
  const frame = el('figure', { class: 'sheet-photo', tabindex: '0' }, [img]);
  if (image.legend || image.place) {
    frame.append(el('figcaption', {}, [
      ...(image.legend ? [el('span', { text: image.legend })] : []),
      ...(image.place ? [el('span', { text: image.place })] : []),
    ]));
  }
  // Clic o Enter → visor (salvo mientras se encuadra o al pulsar Guardar / Cancelar).
  const onOpen = (e) => {
    if (frame.classList.contains('adjusting') || e.target.closest('.adjust-bar, .adjust-btn')) return;
    open();
  };
  frame.addEventListener('click', onOpen);
  frame.addEventListener('keydown', (e) => e.key === 'Enter' && e.target === frame && onOpen(e));
  if (adminPassword) {
    frame.append(adjustButton(() => startAdjust({ frame, item: image, endpoint: `/api/events/${event.id}/images` })));
  }
  return frame;
}

// Muestra u oculta un formulario "+ Añadir…" y el botón que lo abre (cuando
// el formulario está abierto, el botón se oculta).
function toggleForm(form, button, open) {
  form.classList.toggle('hidden', !open);
  button.classList.toggle('hidden', open || !adminPassword);
  if (open) form.querySelector('input[name=title]')?.focus(); // (polaroids no tiene título)
  else form.reset();
}

// --- Formulario de eventos (publicar y editar) ---
let editingEvent = null; // evento que se está editando (null = publicar uno nuevo)
// Al editar: fotos actuales con su leyenda; "removed" marca las que se quitarán al guardar.
let eventKeep = [];

function toggleEventForm(open, event = null) {
  const form = $('#event-form');
  form.reset(); // empezamos siempre con el formulario vacío
  toggleForm(form, $('#add-event-btn'), open);
  editingEvent = open ? event : null;
  const editing = Boolean(editingEvent);
  eventKeep = editing
    ? editingEvent.images.map((image) => ({ image, legend: image.legend, place: image.place, removed: false }))
    : [];

  $('#event-form-title').textContent = editing ? 'Editar evento' : 'Nuevo evento';
  $('#event-submit').textContent = editing ? 'Guardar cambios' : 'Publicar';
  const hasLogo = editing && Boolean(editingEvent.logo);
  $('#event-logo-text').textContent = hasLogo ? 'Cambiar logo (opcional)' : 'Logo del evento (opcional)';
  $('#event-remove-logo').classList.toggle('hidden', !hasLogo);

  // Rellenamos los textos con los datos actuales del evento.
  if (editing) {
    const f = form.elements;
    f.title.value = editingEvent.title;
    f.date.value = editingEvent.date;
    f.detail.value = editingEvent.detail;
    f.description.value = editingEvent.description;
    editingEvent.credits.forEach((c, i) => {
      f[`credit${i + 1}Label`].value = c.label;
      f[`credit${i + 1}Value`].value = c.value;
    });
    form.scrollIntoView({ block: 'start' });
  }
  renderEventExisting();
}

// Fotos que tendrá el evento si se guarda ahora (conservadas + nuevas).
const keptPhotos = () => eventKeep.filter((k) => !k.removed);

// Fila con la miniatura de una foto y sus dos campos de leyenda.
function captionRow(src, { legend = '', place = '', names } = {}) {
  const legendInput = el('input', { type: 'text', placeholder: 'Leyenda de la fotografía', maxlength: '80' });
  const placeInput = el('input', { type: 'text', placeholder: 'Evento o lugar donde se tomó', maxlength: '80' });
  legendInput.value = legend;
  placeInput.value = place;
  if (names) {
    legendInput.name = names[0];
    placeInput.name = names[1];
  }
  const row = el('div', { class: 'caption-row' }, [
    el('img', { src, alt: '' }),
    el('div', { class: 'caption-fields' }, [legendInput, placeInput]),
  ]);
  return { row, legendInput, placeInput };
}

// Al editar: fotos actuales, con su leyenda y un botón para quitarlas o recuperarlas.
function renderEventExisting() {
  const box = $('#event-existing');
  box.classList.toggle('hidden', !editingEvent);
  box.replaceChildren(...eventKeep.map((k) => {
    const { row, legendInput, placeInput } = captionRow(k.image.thumb, k);
    legendInput.addEventListener('input', () => (k.legend = legendInput.value));
    placeInput.addEventListener('input', () => (k.place = placeInput.value));
    legendInput.disabled = placeInput.disabled = k.removed;
    row.classList.toggle('removed', k.removed);
    const toggle = el('button', {
      type: 'button',
      class: 'caption-remove',
      text: k.removed ? 'Recuperar' : '×',
      'aria-label': k.removed ? 'Recuperar foto' : 'Quitar foto',
    });
    toggle.addEventListener('click', () => {
      k.removed = !k.removed;
      renderEventExisting();
    });
    row.append(toggle);
    return row;
  }));
  updateEventPhotoLimit();
}

// Ajusta cuántas fotos nuevas se pueden elegir (3 menos las que se conservan).
function updateEventPhotoLimit() {
  const input = $('#event-form input[name=images]');
  const kept = keptPhotos().length;
  const free = EVENT_MAX_PHOTOS - kept;
  input.dataset.max = String(Math.max(free, 1));
  input.disabled = free <= 0;
  input.closest('.dropzone-wrap').querySelector('.drive-btn').disabled = free <= 0;
  input.required = kept === 0; // sin fotos conservadas, hay que elegir al menos una
  $('#event-drop-text').innerHTML = !editingEvent
    ? 'Fotos del evento (de 1 a 3)<br>arrastra o haz clic para elegirlas'
    : free > 0
      ? `Añadir fotos (puedes añadir ${free} más)<br>arrastra o haz clic para elegirlas`
      : 'El evento ya tiene 3 fotos<br>quita alguna para añadir otra';
}

// Cada vez que cambian las fotos nuevas elegidas, pedimos la leyenda de cada una.
$('#event-form input[name=images]').addEventListener('fileschange', (e) => {
  $('#event-captions').replaceChildren(...[...e.target.files].map((file, i) =>
    captionRow(URL.createObjectURL(file), { names: [`legend${i}`, `place${i}`] }).row));
});

$('#add-event-btn').addEventListener('click', () => toggleEventForm(true));
$('#cancel-event-btn').addEventListener('click', () => toggleEventForm(false));

setupUploadForm($('#event-form'), {
  // Publicar (POST) o guardar los cambios del evento que se edita (PUT).
  endpoint: () => (editingEvent
    ? { url: `/api/events/${editingEvent.id}`, method: 'PUT' }
    : { url: '/api/events', method: 'POST' }),
  successText: () => (editingEvent ? 'Cambios guardados' : 'Evento publicado'),
  // Antes de enviar: comprobamos que queden de 1 a 3 fotos y, al editar,
  // añadimos qué fotos actuales se conservan y con qué leyenda.
  prepare: (data) => {
    const added = data.getAll('images').filter((f) => f.size).length;
    const total = keptPhotos().length + added;
    if (total < 1) return 'El evento necesita al menos una foto.';
    if (total > EVENT_MAX_PHOTOS) return `Cada evento lleva como máximo ${EVENT_MAX_PHOTOS} fotos (ahora serían ${total}).`;
    if (editingEvent) {
      data.set('keep', JSON.stringify(keptPhotos().map((k) => ({ id: k.image.id, legend: k.legend, place: k.place }))));
    }
    return '';
  },
  onSuccess: () => {
    loadEvents();
    // Cerramos el formulario un momento después para que se lea el mensaje.
    setTimeout(() => toggleEventForm(false), 1200);
  },
});

// ---------------------------------------------------------------------------
// Polaroids
// ---------------------------------------------------------------------------

const POLAROIDS_MAX = 4; // el mismo máximo que acepta el servidor
let polaroidsCount = 0; // cuántas hay ahora (para saber cuántos huecos quedan)

// Pide las polaroids y pinta la cuadrícula de 2 × 2.
async function loadPolaroids() {
  // El servidor las da ya en el orden elegido (las nuevas, al final).
  const polaroids = await fetch('/api/polaroids').then((r) => r.json());
  polaroidsCount = polaroids.length;
  const free = POLAROIDS_MAX - polaroids.length;

  $('#polaroids-empty').textContent = 'No hay polaroids registradas.';
  // Los visitantes ven el aviso si no hay ninguna; en modo edición se ven los marcos vacíos.
  $('#polaroids-empty').classList.toggle('hidden', polaroids.length > 0 || Boolean(adminPassword));

  const frames = polaroids.map((polaroid, i) => polaroidFrame(polaroid, polaroids, i));
  // En modo edición, cada hueco libre se muestra como un marco vacío que abre el formulario.
  if (adminPassword) {
    for (let i = 0; i < free; i++) {
      const slot = el('button', { class: 'polaroid polaroid-empty', type: 'button', 'aria-label': 'Añadir polaroid' }, [
        el('span', { text: '+' }),
      ]);
      slot.addEventListener('click', () => togglePolaroidForm(true));
      frames.push(slot);
    }
  }
  $('#polaroids-grid').replaceChildren(...frames);

  // El formulario solo deja elegir tantas fotos como huecos queden.
  const input = $('#polaroid-form input[type=file]');
  input.dataset.max = String(Math.max(free, 1));
  $('#polaroid-drop-text').innerHTML = free > 1
    ? `Arrastra hasta ${free} fotografías<br>o haz clic para elegirlas`
    : 'Arrastra una fotografía<br>o haz clic para elegirla';
  $('#polaroid-hint').textContent = `Quedan ${free} ${free === 1 ? 'hueco libre' : 'huecos libres'} de ${POLAROIDS_MAX}. Se colocan en el orden en que las elijas.`;
  // Sin huecos libres no tiene sentido el botón ni el formulario.
  if (free === 0) togglePolaroidForm(false);
  else $('#add-polaroid-btn').classList.toggle('hidden', !adminPassword || !$('#polaroid-form').classList.contains('hidden'));
}

// Crea el marco de una polaroid. Al hacer clic se abre en el visor, junto con las demás.
function polaroidFrame(polaroid, all, index) {
  const img = el('img', { src: polaroid.thumb, alt: `Polaroid ${index + 1}`, loading: 'lazy', draggable: 'false' });
  applyFocus(img, polaroid.focus); // encuadre guardado (qué parte de la foto se ve)
  const photo = el('div', { class: 'polaroid-photo' }, [img]);
  const frame = el('figure', { class: 'polaroid', tabindex: '0' }, [photo]);

  const open = (e) => {
    // No abrir el visor mientras se encuadra ni al pulsar Guardar / Cancelar
    // (closest funciona aunque la barra ya se haya quitado de la página).
    if (photo.classList.contains('adjusting') || e.target.closest('.adjust-bar')) return;
    openLightbox(all, index);
  };
  frame.addEventListener('click', open);
  frame.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target === frame) open(e);
  });

  if (adminPassword) {
    const del = el('button', { class: 'delete', 'aria-label': 'Eliminar polaroid', text: '×' });
    del.addEventListener('click', (e) => {
      e.stopPropagation(); // que no se abra el visor
      deleteItem('/api/polaroids', polaroid, loadPolaroids);
    });
    frame.append(del, orderButtons(all, index));
    photo.append(adjustButton(() => startAdjust({ frame: photo, item: polaroid, endpoint: '/api/polaroids' })));
    makeDraggable(frame, photo, all, index);
  }
  return frame;
}

// --- Cambiar el orden de las polaroids (modo edición) ---
// Dos formas: arrastrar una polaroid encima de otra (con el ratón) o usar las
// flechas ‹ › de cada una (cómodas también en el móvil). El cambio se guarda al momento.

// Mueve la polaroid de la posición "from" a la posición "to" y guarda el orden.
async function movePolaroid(all, from, to) {
  if (from === to || to < 0 || to >= all.length) return;
  const ids = all.map((p) => p.id);
  const [moved] = ids.splice(from, 1);
  ids.splice(to, 0, moved);
  const res = await fetch('/api/polaroids/order', {
    method: 'PUT',
    headers: { 'x-admin-password': adminPassword, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) alert((await res.json()).error);
  loadPolaroids();
}

// Flechas para mover una polaroid un puesto antes o después.
function orderButtons(all, index) {
  const button = (text, label, to) => {
    const b = el('button', { class: 'order-btn', type: 'button', text, 'aria-label': label, title: label });
    b.disabled = to < 0 || to >= all.length;
    b.addEventListener('click', (e) => {
      e.stopPropagation(); // que no se abra el visor
      movePolaroid(all, index, to);
    });
    return b;
  };
  return el('div', { class: 'order-btns' }, [
    button('‹', 'Mover antes', index - 1),
    el('span', { text: String(index + 1) }), // número de posición
    button('›', 'Mover después', index + 1),
  ]);
}

// Arrastrar y soltar (HTML5 drag and drop). Mientras se encuadra una foto, el
// arrastre está desactivado para no confundirlo con mover la imagen dentro del marco.
let polaroidDragFrom = null; // posición de la polaroid que se está arrastrando

function makeDraggable(frame, photo, all, index) {
  frame.draggable = true;
  frame.addEventListener('dragstart', (e) => {
    if (photo.classList.contains('adjusting')) return e.preventDefault();
    polaroidDragFrom = index;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', ''); // Firefox solo arrastra si hay algún dato
    frame.classList.add('dragging');
  });
  frame.addEventListener('dragend', () => {
    polaroidDragFrom = null;
    frame.classList.remove('dragging');
  });
  frame.addEventListener('dragover', (e) => {
    // Solo aceptamos polaroids (no, por ejemplo, archivos arrastrados desde el computador).
    if (polaroidDragFrom === null) return;
    e.preventDefault(); // necesario para que el navegador permita soltar aquí
    frame.classList.add('drop-target');
  });
  frame.addEventListener('dragleave', () => frame.classList.remove('drop-target'));
  frame.addEventListener('drop', (e) => {
    e.preventDefault();
    frame.classList.remove('drop-target');
    if (polaroidDragFrom !== null) movePolaroid(all, polaroidDragFrom, index);
  });
}

const togglePolaroidForm = (open) => {
  toggleForm($('#polaroid-form'), $('#add-polaroid-btn'), open);
  // Si ya están las 4, el botón "+ Añadir polaroids" no se muestra.
  if (polaroidsCount >= POLAROIDS_MAX) $('#add-polaroid-btn').classList.add('hidden');
};

$('#add-polaroid-btn').addEventListener('click', () => togglePolaroidForm(true));
$('#cancel-polaroid-btn').addEventListener('click', () => togglePolaroidForm(false));

setupUploadForm($('#polaroid-form'), {
  endpoint: '/api/polaroids',
  successText: 'Polaroids subidas',
  onSuccess: () => {
    loadPolaroids();
    setTimeout(() => togglePolaroidForm(false), 1200);
  },
});

// ---------------------------------------------------------------------------
// Shootings
// ---------------------------------------------------------------------------

// Pide el shooting y lo pinta con forma de revista.
async function loadShootings() {
  const [shootings] = await Promise.all([
    fetch('/api/shootings').then((r) => r.json()),
    configReady, // esperamos al nombre, que va en la cabecera de la portada
  ]);
  shootingsCount = shootings.length;
  $('#shootings-empty').textContent = adminPassword
    ? 'Aún no hay shooting. Pulsa «+ Añadir shooting» para publicarlo.'
    : 'No hay shootings registrados.';
  $('#shootings-empty').classList.toggle('hidden', shootings.length > 0);
  $('#shootings-list').replaceChildren(...shootings.map(shootingMagazine));
  updateShootingControls();
}

// Solo se permite un shooting: en modo edición, el botón "+ Añadir shooting"
// aparece mientras no haya ninguno; si ya hay uno, se muestra un aviso.
function updateShootingControls() {
  const formOpen = !$('#shooting-form').classList.contains('hidden');
  $('#add-shooting-btn').classList.toggle('hidden', !adminPassword || shootingsCount > 0 || formOpen);
  $('#shooting-limit').classList.toggle('hidden', !adminPassword || shootingsCount === 0);
}

// Divide una lista en grupos de "size" elementos: chunk([1,2,3,4,5], 4) → [[1,2,3,4],[5]].
const chunk = (list, size) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

// Quita una página del collage (sus 4 imágenes) tras pedir confirmación.
async function removeShootingPage(shooting, page) {
  if (!confirm(`¿Quitar la página ${String(page + 1).padStart(2, '0')} del collage? Se borrarán sus 4 imágenes.`)) return;
  const res = await fetch(`/api/shootings/${shooting.id}/pages/${page}`, {
    method: 'DELETE',
    headers: { 'x-admin-password': adminPassword },
  });
  if (!res.ok) alert((await res.json()).error);
  loadShootings();
}

/**
 * Crea el shooting con forma de revista. Es un pequeño carrusel de "páginas":
 *   1. la portada: foto a sangre, con "SHOOTING" como cabecera (como el
 *      logotipo de una revista) y el subtítulo y el título como titular;
 *   2. las páginas interiores (02, 03, 04…): cada una con 4 imágenes del
 *      collage en cuadrícula 2×2 y un pie de página (folio) como en las revistas.
 * Las páginas están una al lado de la otra dentro de una fila con scroll
 * horizontal. "scroll-snap" (en el CSS) hace que siempre quede una entera a la
 * vista, y así en el móvil también se puede pasar de una a otra deslizando el dedo.
 */
function shootingMagazine(shooting) {
  // Todas las fotos del shooting, en orden, para recorrerlas en el visor.
  const all = [shooting.cover, ...shooting.images].map((img) => ({
    ...img, title: shooting.title, description: shooting.description,
  }));
  // Cada imagen abre el visor en su posición al hacer clic.
  const photo = (img, index) => {
    const image = el('img', { src: img.thumb, alt: shooting.title, loading: 'lazy' });
    image.addEventListener('click', () => openLightbox(all, index));
    return image;
  };

  // Página 1: portada. Los textos van encima de la foto (el CSS deja pasar los
  // clics a través de ellos para que la foto siga abriendo el visor).
  const cover = el('div', { class: 'shooting-slide magazine-cover' }, [
    photo(shooting.cover, 0),
    el('div', { class: 'cover-overlay' }, [
      el('p', { class: 'cover-masthead', text: 'Shooting' }),
      el('div', { class: 'cover-lines' }, [
        // Subtítulo que escribe la persona al publicar (si lo deja vacío, el CSS lo oculta).
        el('p', { class: 'cover-kicker', text: shooting.subtitle || '' }),
        el('h3', { class: 'cover-title', text: shooting.title }),
      ]),
    ]),
  ]);

  // Páginas interiores: una por cada grupo de 4 imágenes del collage, con pie
  // de página (título a la izquierda, número de página a la derecha).
  const pages = chunk(shooting.images, 4).map((pageImages, p) => {
    const first = 1 + p * 4; // posición de su primera imagen en el visor (la portada es la 0)
    const page = el('div', { class: 'shooting-slide magazine-page' }, [
      el('div', { class: 'collage-grid' }, pageImages.map((img, i) => photo(img, first + i))),
      el('div', { class: 'folio' }, [
        el('span', { text: shooting.title }),
        el('span', { text: String(p + 2).padStart(2, '0') }), // 02, 03, 04…
      ]),
    ]);
    // En modo edición, cada página se puede quitar (si hay más de una).
    if (adminPassword && shooting.images.length > 4) {
      const remove = el('button', { class: 'remove-page-btn', text: 'Quitar página' });
      remove.addEventListener('click', () => removeShootingPage(shooting, p + 1));
      page.append(remove);
    }
    return page;
  });

  const track = el('div', { class: 'shooting-track' }, [cover, ...pages]);
  const total = 1 + pages.length; // portada + páginas interiores

  // Flechas (iconos SVG, para que queden perfectamente centradas en el círculo)
  // y un puntito por página. Cada flecha desplaza la fila un ancho de página.
  const arrow = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  const prev = el('button', { class: 'slide-btn prev', 'aria-label': 'Página anterior' });
  const next = el('button', { class: 'slide-btn next', 'aria-label': 'Página siguiente' });
  prev.innerHTML = arrow('M15 5l-7 7 7 7');
  next.innerHTML = arrow('M9 5l7 7-7 7');
  const dots = Array.from({ length: total }, () => el('span', { class: 'dot' }));
  prev.addEventListener('click', () => track.scrollBy({ left: -track.clientWidth }));
  next.addEventListener('click', () => track.scrollBy({ left: track.clientWidth }));

  // Al desplazarse (con flechas o con el dedo), actualizamos qué punto está
  // activo y ocultamos la flecha que ya no lleva a ningún sitio.
  function updateControls() {
    const page = Math.round(track.scrollLeft / track.clientWidth);
    dots.forEach((dot, i) => dot.classList.toggle('active', i === page));
    prev.classList.toggle('hidden', page === 0);
    next.classList.toggle('hidden', page === total - 1);
  }
  track.addEventListener('scroll', updateControls, { passive: true });
  requestAnimationFrame(updateControls); // estado inicial, cuando ya tiene tamaño

  const magazine = el('article', { class: 'magazine' }, [
    el('div', { class: 'magazine-viewer' }, [track, prev, next, el('div', { class: 'dots' }, dots)]),
    // La descripción va debajo, centrada, como el pie de foto de una revista.
    el('p', { class: 'magazine-caption', text: shooting.description }),
  ]);

  if (adminPassword) {
    const edit = el('button', { class: 'edit-btn', text: 'Editar' });
    edit.addEventListener('click', () => toggleShootingForm(true, shooting));
    const del = el('button', { class: 'delete', 'aria-label': 'Eliminar shooting', text: '×' });
    del.addEventListener('click', () => deleteItem('/api/shootings', shooting, loadShootings));
    magazine.append(edit, del);
  }
  return magazine;
}

/**
 * Abre o cierra el formulario de shooting.
 *   toggleShootingForm(true)            → publicar uno nuevo
 *   toggleShootingForm(true, shooting)  → editar el que ya existe
 *   toggleShootingForm(false)           → cerrar
 */
function toggleShootingForm(open, shooting = null) {
  const form = $('#shooting-form');
  toggleForm(form, $('#add-shooting-btn'), open); // al cerrar, también lo vacía
  editingShooting = open ? shooting : null;
  const editing = Boolean(editingShooting);

  // Al editar, las imágenes son opcionales: si no se elige ninguna, se conservan.
  form.elements.cover.required = !editing;
  form.elements.images.required = !editing;
  $('#shooting-form-heading').textContent = editing ? 'Editar shooting' : 'Nuevo shooting';
  $('#shooting-submit').textContent = editing ? 'Guardar cambios' : 'Publicar';
  $('#shooting-cover-text').innerHTML = editing
    ? 'Cambiar portada (opcional)<br>si no eliges ninguna, se conserva la actual'
    : 'Portada<br>arrastra una imagen o haz clic';
  // Al editar, las imágenes de esta zona se AÑADEN al collage como páginas nuevas.
  $('#shooting-collage-text').innerHTML = editing
    ? 'Añadir páginas al collage (opcional)<br>4 imágenes por página: elige 4, 8, 12…'
    : 'Collage · 4 imágenes por página<br>elige 4, 8, 12… a la vez';

  // Organizador del collage: solo al editar, con las páginas actuales.
  organizer = editing
    ? { pages: chunk(editingShooting.images, 4).map((page) => [...page]), removed: [] }
    : null;
  $('#shooting-organizer').classList.toggle('hidden', !editing);
  if (editing) renderOrganizer();

  // Rellenamos los textos con los datos actuales del shooting.
  if (editing) {
    form.elements.title.value = editingShooting.title;
    form.elements.subtitle.value = editingShooting.subtitle || '';
    form.elements.description.value = editingShooting.description;
    form.scrollIntoView({ block: 'start' });
  }
  updateShootingControls();
}

$('#add-shooting-btn').addEventListener('click', () => toggleShootingForm(true));
$('#cancel-shooting-btn').addEventListener('click', () => toggleShootingForm(false));

// ---------------------------------------------------------------------------
// Organizador del collage (al editar el shooting)
// ---------------------------------------------------------------------------
// Estado: organizer.pages es una lista de páginas y cada página una lista de
// imágenes. organizer.removed guarda las imágenes quitadas (se borran al guardar).
// Los cambios solo se aplican al pulsar "Guardar cambios".
let organizer = null;
let dragFrom = null; // { page, index } de la imagen que se está arrastrando

const pageNumber = (p) => String(p + 2).padStart(2, '0'); // la portada es la 01

/**
 * Comprueba que todas las páginas tengan 4 imágenes. Devuelve el texto del
 * aviso, o nada si todo está bien. Las páginas vacías no cuentan (se eliminan).
 *   added → cuántas imágenes nuevas se añaden como páginas nuevas
 */
function organizerProblem(added = 0) {
  const wrong = organizer.pages
    .map((page, p) => ({ p, count: page.length }))
    .filter(({ count }) => count > 0 && count !== 4);
  if (wrong.length) {
    const detail = wrong.map(({ p, count }) => `la página ${pageNumber(p)} tiene ${count}`).join(', ');
    return `Cada página del collage requiere 4 imágenes: ${detail}. Mueve o quita imágenes hasta que todas tengan 4.`;
  }
  if (!organizer.pages.flat().length && !added) return 'El collage debe tener al menos una página de 4 imágenes.';
}

// Mueve una imagen a otra posición (en la misma página o en otra).
function moveImage(from, to) {
  const [img] = organizer.pages[from.page].splice(from.index, 1);
  // Si se mueve hacia delante en la misma página, al sacarla se corre una posición.
  const index = from.page === to.page && from.index < to.index ? to.index - 1 : to.index;
  organizer.pages[to.page].splice(index, 0, img);
  renderOrganizer();
}

// Quita una imagen (se borrará al guardar) o recupera todas las quitadas.
function removeImage(page, index) {
  organizer.removed.push(...organizer.pages[page].splice(index, 1));
  renderOrganizer();
}
function restoreRemoved() {
  if (!organizer.pages.length) organizer.pages.push([]);
  organizer.pages.at(-1).push(...organizer.removed.splice(0));
  renderOrganizer();
}

// Pinta el organizador: una fila por página con sus miniaturas.
function renderOrganizer() {
  const box = $('#shooting-organizer');
  const lastPage = organizer.pages.length - 1;

  const pages = organizer.pages.map((images, p) => {
    const ok = images.length === 4;
    const thumbs = images.map((img, i) => {
      const thumb = el('div', { class: 'org-thumb', draggable: 'true' }, [el('img', { src: img.thumb, alt: '', draggable: 'false' })]);

      // Botones: mover a la izquierda / derecha (pasando a la página vecina en
      // los extremos) y quitar.
      const first = p === 0 && i === 0;
      const last = p === lastPage && i === images.length - 1;
      const left = el('button', { type: 'button', class: 'org-btn', 'aria-label': 'Mover antes', text: '‹' });
      const right = el('button', { type: 'button', class: 'org-btn', 'aria-label': 'Mover después', text: '›' });
      const remove = el('button', { type: 'button', class: 'org-btn org-remove', 'aria-label': 'Quitar imagen', text: '×' });
      left.disabled = first;
      right.disabled = last;
      left.addEventListener('click', () => (i > 0
        ? moveImage({ page: p, index: i }, { page: p, index: i - 1 })
        : moveImage({ page: p, index: i }, { page: p - 1, index: organizer.pages[p - 1].length })));
      right.addEventListener('click', () => (i < images.length - 1
        ? moveImage({ page: p, index: i }, { page: p, index: i + 2 })
        : moveImage({ page: p, index: i }, { page: p + 1, index: 0 })));
      remove.addEventListener('click', () => removeImage(p, i));
      thumb.append(el('div', { class: 'org-actions' }, [left, right, remove]));

      // Arrastrar y soltar (ratón): al soltar sobre otra miniatura, la imagen
      // se coloca en su lugar.
      thumb.addEventListener('dragstart', (e) => {
        dragFrom = { page: p, index: i };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', ''); // Firefox necesita algún dato para arrastrar
        thumb.classList.add('dragging');
      });
      thumb.addEventListener('dragend', () => thumb.classList.remove('dragging'));
      thumb.addEventListener('dragover', (e) => {
        e.preventDefault(); // permite soltar aquí
        thumb.classList.add('drop-target');
      });
      thumb.addEventListener('dragleave', () => thumb.classList.remove('drop-target'));
      thumb.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation(); // que no lo reciba también la página
        if (dragFrom) moveImage(dragFrom, { page: p, index: i });
        dragFrom = null;
      });
      return thumb;
    });

    const grid = el('div', { class: 'org-grid' }, thumbs.length ? thumbs : [el('p', { class: 'org-empty', text: 'Página vacía: arrastra imágenes aquí' })]);
    const row = el('div', { class: 'org-page' }, [
      el('div', { class: 'org-page-head' }, [
        el('span', { text: `Página ${pageNumber(p)}` }),
        el('span', { class: `org-count ${ok ? 'ok' : images.length ? 'bad' : ''}`, text: `${images.length}/4` }),
      ]),
      grid,
    ]);
    // Soltar sobre el espacio libre de una página: la imagen va al final de esa página.
    row.addEventListener('dragover', (e) => e.preventDefault());
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      if (dragFrom) moveImage(dragFrom, { page: p, index: organizer.pages[p].length });
      dragFrom = null;
    });
    return row;
  });

  const addPage = el('button', { type: 'button', class: 'btn btn-outline', text: '+ Página vacía' });
  addPage.addEventListener('click', () => {
    organizer.pages.push([]);
    renderOrganizer();
  });
  const footer = [addPage];
  if (organizer.removed.length) {
    const restore = el('button', { type: 'button', class: 'btn btn-outline', text: 'Recuperar quitadas' });
    restore.addEventListener('click', restoreRemoved);
    footer.push(el('span', { class: 'org-note', text: `${organizer.removed.length} imagen(es) se quitarán al guardar.` }), restore);
  }

  box.replaceChildren(
    el('p', { class: 'eyebrow', text: 'Orden del collage' }),
    el('p', { class: 'org-help', text: 'Arrastra las imágenes (o usa ‹ ›) para cambiarlas de orden o de página. Cada página debe tener 4 imágenes para poder guardar.' }),
    // Aviso del último intento de guardar (desaparece cuando todo está bien).
    el('p', { class: 'org-warning', role: 'alert', text: organizer.warning ? organizerProblem() || '' : '' }),
    ...pages,
    el('div', { class: 'form-actions org-footer' }, footer),
  );
}

setupUploadForm($('#shooting-form'), {
  // Si se está editando, se envía con PUT a la ruta del shooting; si no, se publica uno nuevo.
  endpoint: () => (editingShooting
    ? { url: `/api/shootings/${editingShooting.id}`, method: 'PUT' }
    : { url: '/api/shootings', method: 'POST' }),
  successText: () => (editingShooting ? 'Cambios guardados' : 'Shooting publicado'),
  // Al editar: comprobamos que cada página tenga 4 imágenes y enviamos el nuevo orden.
  prepare: (data) => {
    if (!organizer) return;
    const problem = organizerProblem(data.getAll('images').filter((f) => f.size).length);
    // El aviso se muestra junto al botón Guardar y también arriba, en el organizador.
    organizer.warning = problem || '';
    renderOrganizer();
    if (problem) {
      $('#shooting-organizer').scrollIntoView({ block: 'start' });
      return problem;
    }
    data.set('order', JSON.stringify(organizer.pages.flat().map((img) => img.id)));
  },
  onSuccess: () => {
    loadShootings();
    setTimeout(() => toggleShootingForm(false), 1200);
  },
});

// ---------------------------------------------------------------------------
// Google Drive: elegir fotos desde Drive
// ---------------------------------------------------------------------------
// Funciona con dos librerías oficiales de Google que se cargan solo cuando hacen falta:
//   - Google Identity Services (accounts.google.com/gsi/client): abre la ventana
//     de inicio de sesión de Google y nos da un "token" de acceso temporal.
//   - Google Picker (apis.google.com/js/api.js): la ventana para elegir archivos de Drive.
// Pedimos el permiso "drive.file", el más limitado: la web solo puede leer los
// archivos que elijas en el selector, nunca el resto de tu Drive.
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/gif'; // los mismos que acepta el servidor

let googleReady = null; // Promise de carga de las librerías (se cargan una sola vez)
let driveToken = null; // { value, expires }: token de acceso y cuándo caduca

// Añade un <script> a la página y espera a que termine de cargar.
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error('No se pudo conectar con Google. Revisa tu conexión.'));
    document.head.append(script);
  });
}

// Carga las dos librerías de Google. Se llama al entrar en modo edición para
// que estén listas antes de pulsar el botón: el navegador solo permite abrir la
// ventana de inicio de sesión justo después de un clic, sin esperas largas.
function loadGoogle() {
  googleReady ??= Promise.all([
    loadScript('https://accounts.google.com/gsi/client'),
    loadScript('https://apis.google.com/js/api.js').then(() => new Promise((resolve) => gapi.load('picker', resolve))),
  ]).catch((error) => {
    googleReady = null; // permitir reintentar
    throw error;
  });
  return googleReady;
}

// Pide a Google un token de acceso (abre la ventana de inicio de sesión la
// primera vez). El token dura aproximadamente una hora; mientras sea válido lo reutilizamos.
function getDriveToken() {
  if (driveToken && Date.now() < driveToken.expires) return Promise.resolve(driveToken.value);
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: googleConfig.clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response.error) return reject(new Error('Google no dio permiso para acceder a Drive.'));
        // Lo damos por caducado un minuto antes, por seguridad.
        driveToken = { value: response.access_token, expires: Date.now() + (response.expires_in - 60) * 1000 };
        resolve(driveToken.value);
      },
      error_callback: (error) => reject(new Error(error.type === 'popup_closed'
        ? 'Se cerró la ventana de Google sin iniciar sesión.'
        : 'No se pudo abrir la ventana de Google. Revisa que el navegador no bloquee las ventanas emergentes.')),
    });
    client.requestAccessToken();
  });
}

/**
 * Mantiene la página en la posición vertical "y" durante unos instantes.
 * El selector de Google, al cerrarse, deja el foco en un elemento suyo situado
 * al final de la página y el navegador baja hasta allí. Durante un momento
 * devolvemos la página a donde estaba cada vez que intente moverse.
 * (behavior: 'instant' evita la animación de scroll suave del CSS.)
 */
function holdScroll(y, ms = 800) {
  const restore = () => window.scrollTo({ top: y, behavior: 'instant' });
  restore();
  window.addEventListener('scroll', restore);
  setTimeout(() => window.removeEventListener('scroll', restore), ms);
}

// Abre el selector de Google Drive y devuelve los archivos elegidos
// (una lista vacía si se cierra sin elegir nada).
function openDrivePicker(token, { multiple, max }) {
  // Recordamos dónde estaba la página para volver ahí al cerrar el selector.
  const scrollY = window.scrollY;
  const close = (docs, resolve) => {
    holdScroll(scrollY);
    resolve(docs);
  };

  return new Promise((resolve) => {
    // Vista de Drive que muestra solo imágenes de los tipos admitidos, con carpetas para navegar.
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setMimeTypes(DRIVE_IMAGE_TYPES)
      .setIncludeFolders(true)
      .setMode(google.picker.DocsViewMode.GRID);
    const builder = new google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(googleConfig.apiKey)
      .setAppId(googleConfig.appId) // necesario para que "drive.file" dé acceso a lo elegido
      .setLocale('es')
      // Tamaño de la ventana: el de Google por defecto (1051×650) o menos si la
      // pantalla es más pequeña. El CSS (.picker-dialog) la centra en pantalla.
      .setSize(Math.min(1051, window.innerWidth - 32), Math.min(650, window.innerHeight - 64))
      .setTitle(multiple ? `Elige hasta ${max} imágenes` : 'Elige una imagen')
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) close(data.docs, resolve);
        if (data.action === google.picker.Action.CANCEL) close([], resolve);
      });
    if (multiple) builder.enableFeature(google.picker.Feature.MULTISELECT_ENABLED).setMaxItems(max);
    builder.build().setVisible(true);
  });
}

// Descarga el contenido de un archivo de Drive y lo convierte en un File,
// el mismo tipo de objeto que se obtiene al elegir un archivo del computador.
async function downloadDriveFile(doc, token) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${doc.id}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) driveToken = null; // token caducado: se pedirá otro la próxima vez
  if (!res.ok) throw new Error(`No se pudo descargar «${doc.name}» de Google Drive.`);
  const blob = await res.blob();
  return new File([blob], doc.name, { type: doc.mimeType || blob.type });
}

/**
 * Proceso completo: cargar Google → iniciar sesión → elegir → descargar.
 *   multiple   → si se pueden elegir varias imágenes
 *   max        → cuántas como máximo
 *   onDownload → se llama cuando empieza la descarga (para mostrar un mensaje)
 * Devuelve la lista de archivos (File) listos para el formulario.
 */
async function pickFromDrive({ multiple, max, onDownload }) {
  await loadGoogle();
  const token = await getDriveToken();
  const docs = await openDrivePicker(token, { multiple, max });
  if (!docs.length) return [];
  onDownload?.();
  // Descargamos todas a la vez (en paralelo) para tardar menos.
  return Promise.all(docs.map((doc) => downloadDriveFile(doc, token)));
}

// Añade el logotipo de Google Drive a los botones (una sola vez, al cargar la página).
const DRIVE_ICON = '<svg viewBox="0 0 87.3 78" aria-hidden="true"><path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/><path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z" fill="#00ac47"/><path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/><path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/><path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/><path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/></svg>';
document.querySelectorAll('.drive-btn').forEach((btn) => btn.insertAdjacentHTML('afterbegin', DRIVE_ICON));

// ---------------------------------------------------------------------------
// Tema claro / oscuro
// ---------------------------------------------------------------------------
// El tema elegido se guarda en el atributo data-theme de <html> (el CSS cambia
// los colores según ese atributo) y en localStorage para recordarlo en la
// próxima visita. Si el visitante nunca eligió, se sigue el tema de su sistema.
const systemDark = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => (document.documentElement.dataset.theme || (systemDark.matches ? 'dark' : 'light')) === 'dark';

const MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/></svg>';
const SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';

// El icono muestra el tema al que se cambiará: luna en claro, sol en oscuro.
function updateThemeBtn() {
  const dark = isDark();
  $('#theme-btn').innerHTML = dark ? SUN : MOON;
  $('#theme-btn').setAttribute('aria-label', dark ? 'Activar modo claro' : 'Activar modo oscuro');
  $('#theme-btn').title = dark ? 'Modo claro' : 'Modo oscuro';
}

$('#theme-btn').addEventListener('click', () => {
  const theme = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  // localStorage puede estar bloqueado (modo privado estricto); en ese caso el
  // tema funciona igual, solo que no se recuerda.
  try { localStorage.setItem('theme', theme); } catch {}
  updateThemeBtn();
});
systemDark.addEventListener('change', updateThemeBtn); // si el sistema cambia de tema
updateThemeBtn();

// ---------------------------------------------------------------------------
// Sombra de la barra superior al bajar
// ---------------------------------------------------------------------------
// En cuanto la página se desplaza un poco, la barra recibe la clase "scrolled"
// y el CSS le pone una sombra suave. "passive: true" le indica al navegador que
// no vamos a bloquear el scroll, así se mantiene fluido.
function updateTopbarShadow() {
  $('.topbar').classList.toggle('scrolled', window.scrollY > 8);
}
window.addEventListener('scroll', updateTopbarShadow, { passive: true });
updateTopbarShadow(); // por si la página se abre ya desplazada (p. ej. al recargar)

// ---------------------------------------------------------------------------
// Botón "volver al inicio"
// ---------------------------------------------------------------------------
// IntersectionObserver avisa cuando la portada entra o sale de la pantalla,
// sin tener que comprobar la posición en cada movimiento del scroll.
// Mientras la portada se ve, el botón queda oculto (clase "away").
new IntersectionObserver(([entry]) => {
  $('#to-top').classList.toggle('away', entry.isIntersecting);
}).observe($('.hero'));

$('#to-top').addEventListener('click', () => {
  // El desplazamiento es suave gracias a "scroll-behavior: smooth" del CSS
  // (y es instantáneo para quien tenga desactivadas las animaciones).
  window.scrollTo({ top: 0 });
  // Llevamos el foco del teclado arriba, porque el botón se ocultará al llegar.
  $('#menu-btn').focus({ preventScroll: true });
});

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
$('#year').textContent = new Date().getFullYear();
configReady = loadConfig();
setAdmin(adminPassword); // también carga las fotos, los eventos y los shootings
