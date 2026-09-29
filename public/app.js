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

  $('#hero-image').replaceChildren(cover
    ? el('img', { src: cover.full, alt: cover.title || '' })
    : el('span', { class: 'placeholder', text: 'Tu foto principal aparecerá aquí' }));
}

// Crea la tarjeta de una foto de la galería. En modo edición le añade los
// botones de borrar y de elegir como portada.
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

    figure.append(del, coverBtn);
  }

  // Clic o tecla Enter sobre la foto → abrirla en el visor.
  const open = () => openLightbox(images, images.indexOf(image));
  figure.addEventListener('click', open);
  figure.addEventListener('keydown', (e) => e.key === 'Enter' && open());
  return figure;
}

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
  if (!res.ok) alert((await res.json()).error);
  loadImages();
}

// Borra una foto, un evento o un shooting tras pedir confirmación.
//   endpoint → '/api/images', '/api/events' o '/api/shootings'
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
  $('#add-shooting-btn').classList.toggle('hidden', !password);
  if (!password) {
    toggleEventForm(false);
    toggleShootingForm(false);
  }
  $('#admin-btn').textContent = password ? 'Salir de edición' : 'Editar';
  // Repinta las secciones para mostrar u ocultar los botones de edición.
  loadImages();
  loadEvents();
  loadShootings();
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
 *   endpoint    → a qué ruta de la API se envía ('/api/images', '/api/events'…)
 *   successText → mensaje que se muestra al terminar
 *   onSuccess   → qué hacer después (normalmente, volver a pintar la sección)
 */
function setupUploadForm(form, { endpoint, successText, onSuccess }) {
  const msg = form.querySelector('.msg');
  const submit = form.querySelector('button[type=submit]');

  // Cada zona de archivo (.dropzone) tiene su propia vista previa. El
  // formulario de shootings tiene dos: la portada y las 4 del collage.
  const zones = [...form.querySelectorAll('.dropzone')].map((dropzone) => {
    const input = dropzone.querySelector('input[type=file]');
    const previews = dropzone.querySelector('.previews');
    const dropText = dropzone.querySelector('.drop-text');
    // data-count="4" en el HTML indica cuántas imágenes exactas se piden.
    const count = Number(input.dataset.count) || 0;

    // Muestra miniaturas de las imágenes elegidas antes de subirlas.
    // URL.createObjectURL crea una dirección temporal que apunta al archivo local.
    function showPreview() {
      const files = [...input.files];
      previews.replaceChildren(...files.map((file) => el('img', { src: URL.createObjectURL(file), alt: '' })));
      previews.classList.toggle('multi', files.length > 1); // varias → cuadrícula
      dropText.classList.toggle('hidden', files.length > 0);

      // Si se piden N imágenes exactas, avisamos al navegador cuando no son N:
      // setCustomValidity impide enviar el formulario y muestra el mensaje.
      if (count) {
        input.setCustomValidity(files.length && files.length !== count
          ? `Selecciona exactamente ${count} imágenes (has elegido ${files.length}).`
          : '');
        if (files.length && files.length !== count) input.reportValidity();
      }
    }

    input.addEventListener('change', showPreview);

    // Resalta la zona al arrastrar archivos encima. Soltarlos funciona solo
    // porque el <input type="file"> transparente cubre toda la zona.
    ['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, () => dropzone.classList.add('dragover')));
    ['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, () => dropzone.classList.remove('dragover')));

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
    submit.disabled = true; // evita subir lo mismo dos veces por doble clic
    msg.className = 'msg';
    msg.textContent = 'Subiendo…';

    // FormData empaqueta la imagen, el título y la descripción tal como los espera el servidor.
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'x-admin-password': adminPassword },
      body: new FormData(form),
    });
    submit.disabled = false;

    if (res.ok) {
      form.reset();
      msg.textContent = successText;
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

// Pide la lista de eventos y pinta las tarjetas.
async function loadEvents() {
  const events = await fetch('/api/events').then((r) => r.json());
  // La sección se ve siempre. Si no hay eventos, se muestra un aviso: para los
  // visitantes, un texto sencillo; en modo edición, una indicación de cómo añadir uno.
  $('#events-empty').textContent = adminPassword
    ? 'Aún no hay eventos. Pulsa «+ Añadir evento» para publicar el primero.'
    : 'No hay eventos registrados.';
  $('#events-empty').classList.toggle('hidden', events.length > 0);
  $('#events-list').replaceChildren(...events.map(eventCard));
}

// Crea la tarjeta de un evento: imagen arriba, título y descripción debajo.
function eventCard(event) {
  const article = el('article', { class: 'event-card' }, [
    el('div', { class: 'event-image' }, [
      el('img', { src: event.thumb, alt: event.title, loading: 'lazy' }),
    ]),
    el('div', { class: 'event-body' }, [
      el('h3', { text: event.title }),
      el('p', { text: event.description }),
    ]),
  ]);

  if (adminPassword) {
    const del = el('button', { class: 'delete', 'aria-label': 'Eliminar evento', text: '×' });
    del.addEventListener('click', () => deleteItem('/api/events', event, loadEvents));
    article.append(del);
  }
  return article;
}

// Muestra u oculta un formulario "+ Añadir…" y el botón que lo abre (cuando
// el formulario está abierto, el botón se oculta).
function toggleForm(form, button, open) {
  form.classList.toggle('hidden', !open);
  button.classList.toggle('hidden', open || !adminPassword);
  if (open) form.querySelector('input[name=title]').focus();
  else form.reset();
}

const toggleEventForm = (open) => toggleForm($('#event-form'), $('#add-event-btn'), open);

$('#add-event-btn').addEventListener('click', () => toggleEventForm(true));
$('#cancel-event-btn').addEventListener('click', () => toggleEventForm(false));

setupUploadForm($('#event-form'), {
  endpoint: '/api/events',
  successText: 'Evento publicado',
  onSuccess: () => {
    loadEvents();
    // Cerramos el formulario un momento después para que se lea el mensaje.
    setTimeout(() => toggleEventForm(false), 1200);
  },
});

// ---------------------------------------------------------------------------
// Shootings
// ---------------------------------------------------------------------------

// Pide la lista de shootings y pinta las tarjetas.
async function loadShootings() {
  const shootings = await fetch('/api/shootings').then((r) => r.json());
  $('#shootings-empty').textContent = adminPassword
    ? 'Aún no hay shootings. Pulsa «+ Añadir shooting» para publicar el primero.'
    : 'No hay shootings registrados.';
  $('#shootings-empty').classList.toggle('hidden', shootings.length > 0);
  $('#shootings-list').replaceChildren(...shootings.map(shootingCard));
}

/**
 * Crea la tarjeta de un shooting. Tiene un pequeño carrusel de dos "diapositivas":
 *   1. la portada,
 *   2. el collage de 4 imágenes en cuadrícula 2×2.
 * Las diapositivas están una al lado de la otra dentro de una fila con scroll
 * horizontal. "scroll-snap" (en el CSS) hace que siempre quede una entera a la
 * vista, y así en el móvil también se puede pasar de una a otra deslizando el dedo.
 */
function shootingCard(shooting) {
  // Las 5 fotos del shooting, en orden, para recorrerlas en el visor.
  const all = [shooting.cover, ...shooting.images].map((img) => ({
    ...img, title: shooting.title, description: shooting.description,
  }));
  // Cada imagen abre el visor en su posición al hacer clic.
  const photo = (img, index) => {
    const image = el('img', { src: img.thumb, alt: shooting.title, loading: 'lazy' });
    image.addEventListener('click', () => openLightbox(all, index));
    return image;
  };

  const track = el('div', { class: 'shooting-track' }, [
    el('div', { class: 'shooting-slide' }, [photo(shooting.cover, 0)]),
    el('div', { class: 'shooting-slide collage' }, shooting.images.map((img, i) => photo(img, i + 1))),
  ]);

  // Flechas y puntitos. Cada flecha desplaza la fila exactamente un ancho de tarjeta.
  const prev = el('button', { class: 'slide-btn prev', 'aria-label': 'Ver portada', text: '‹' });
  const next = el('button', { class: 'slide-btn next', 'aria-label': 'Ver collage', text: '›' });
  const dots = [0, 1].map(() => el('span', { class: 'dot' }));
  prev.addEventListener('click', () => track.scrollBy({ left: -track.clientWidth }));
  next.addEventListener('click', () => track.scrollBy({ left: track.clientWidth }));

  // Al desplazarse (con flechas o con el dedo), actualizamos qué punto está
  // activo y ocultamos la flecha que ya no lleva a ningún sitio.
  function updateControls() {
    const slide = Math.round(track.scrollLeft / track.clientWidth);
    dots.forEach((dot, i) => dot.classList.toggle('active', i === slide));
    prev.classList.toggle('hidden', slide === 0);
    next.classList.toggle('hidden', slide === 1);
  }
  track.addEventListener('scroll', updateControls, { passive: true });
  requestAnimationFrame(updateControls); // estado inicial, cuando ya tiene tamaño

  const article = el('article', { class: 'shooting-card' }, [
    el('div', { class: 'shooting-viewer' }, [track, prev, next, el('div', { class: 'dots' }, dots)]),
    el('div', { class: 'event-body' }, [
      el('h3', { text: shooting.title }),
      el('p', { text: shooting.description }),
    ]),
  ]);

  if (adminPassword) {
    const del = el('button', { class: 'delete', 'aria-label': 'Eliminar shooting', text: '×' });
    del.addEventListener('click', () => deleteItem('/api/shootings', shooting, loadShootings));
    article.append(del);
  }
  return article;
}

const toggleShootingForm = (open) => toggleForm($('#shooting-form'), $('#add-shooting-btn'), open);

$('#add-shooting-btn').addEventListener('click', () => toggleShootingForm(true));
$('#cancel-shooting-btn').addEventListener('click', () => toggleShootingForm(false));

setupUploadForm($('#shooting-form'), {
  endpoint: '/api/shootings',
  successText: 'Shooting publicado',
  onSuccess: () => {
    loadShootings();
    setTimeout(() => toggleShootingForm(false), 1200);
  },
});

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
loadConfig();
setAdmin(adminPassword); // también carga las fotos, los eventos y los shootings
