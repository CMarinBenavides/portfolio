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
  $('#monogram').textContent = lines.map((line) => line[0][0]).join('');

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
  const open = () => openLightbox(images.indexOf(image));
  figure.addEventListener('click', open);
  figure.addEventListener('keydown', (e) => e.key === 'Enter' && open());
  return figure;
}

// ---------------------------------------------------------------------------
// Visor de fotos a pantalla completa
// ---------------------------------------------------------------------------

// Muestra la foto en la posición "index". El cálculo con % hace que, al pasar
// de la última, se vuelva a la primera (y al revés).
function openLightbox(index) {
  current = (index + images.length) % images.length;
  const image = images[current];
  $('#lightbox-img').src = image.full;
  $('#lightbox-img').alt = image.title || '';
  $('#lightbox-title').textContent = image.title;
  $('#lightbox-desc').textContent = image.description;
  if (!$('#lightbox').open) $('#lightbox').showModal();
}

// Flechas ‹ › para cambiar de foto; clic en cualquier otro sitio (salvo la
// propia foto) para cerrar. La tecla Esc la cierra el navegador automáticamente.
$('#lightbox').addEventListener('click', (e) => {
  if (e.target.classList.contains('prev')) openLightbox(current - 1);
  else if (e.target.classList.contains('next')) openLightbox(current + 1);
  else if (e.target.tagName !== 'IMG') $('#lightbox').close();
});
$('#lightbox').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') openLightbox(current - 1);
  if (e.key === 'ArrowRight') openLightbox(current + 1);
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

async function deleteImage(image) {
  if (!confirm(`¿Eliminar "${image.title || 'esta imagen'}"?`)) return;
  const res = await fetch(`/api/images/${image.id}`, {
    method: 'DELETE',
    headers: { 'x-admin-password': adminPassword },
  });
  if (!res.ok) alert((await res.json()).error);
  loadImages();
}

// Activa (con contraseña) o desactiva (con null) el modo edición.
function setAdmin(password) {
  adminPassword = password;
  if (password) sessionStorage.setItem('adminPassword', password);
  else sessionStorage.removeItem('adminPassword');
  $('#upload-form').classList.toggle('hidden', !password);
  $('#admin-btn').textContent = password ? 'Salir de edición' : 'Editar';
  loadImages(); // repinta la galería para mostrar u ocultar los botones de edición
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
// Formulario de subida de fotos
// ---------------------------------------------------------------------------
const form = $('#upload-form');
const fileInput = form.querySelector('input[type=file]');
const dropzone = $('#dropzone');

// Muestra una vista previa de la foto elegida antes de subirla.
// URL.createObjectURL crea una dirección temporal que apunta al archivo local.
function showPreview(file) {
  const preview = $('#preview');
  if (!file) {
    preview.classList.add('hidden');
    $('#drop-text').classList.remove('hidden');
    return;
  }
  preview.src = URL.createObjectURL(file);
  preview.classList.remove('hidden');
  $('#drop-text').classList.add('hidden');
}

fileInput.addEventListener('change', () => showPreview(fileInput.files[0]));

// Resalta la zona al arrastrar un archivo encima. Soltarlo funciona solo porque
// el <input type="file"> transparente cubre toda la zona.
['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, () => dropzone.classList.add('dragover')));
['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, () => dropzone.classList.remove('dragover')));

form.addEventListener('submit', async (e) => {
  e.preventDefault(); // evita que el navegador recargue la página al enviar
  const msg = $('#upload-msg');
  const button = form.querySelector('button');
  button.disabled = true; // evita subir la misma foto dos veces por doble clic
  msg.className = 'msg';
  msg.textContent = 'Subiendo…';

  // FormData empaqueta la foto, el título y la descripción tal como los espera el servidor.
  const res = await fetch('/api/images', {
    method: 'POST',
    headers: { 'x-admin-password': adminPassword },
    body: new FormData(form),
  });
  button.disabled = false;

  if (res.ok) {
    msg.textContent = 'Fotografía subida';
    form.reset();
    showPreview(null);
    loadImages();
  } else {
    msg.className = 'msg error';
    msg.textContent = (await res.json()).error;
    if (res.status === 401) setAdmin(null); // la contraseña cambió: salimos del modo edición
  }
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
// Arranque
// ---------------------------------------------------------------------------
$('#year').textContent = new Date().getFullYear();
loadConfig();
setAdmin(adminPassword); // también carga las fotos
