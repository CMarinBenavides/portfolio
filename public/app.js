const $ = (sel) => document.querySelector(sel);

// Iconos SVG simplificados para las redes más comunes (clave = nombre en minúsculas).
const ICONS = {
  instagram: 'M12 2.2c3.2 0 3.6 0 4.8.1 3.3.1 4.8 1.7 4.9 4.9.1 1.3.1 1.6.1 4.8s0 3.6-.1 4.8c-.1 3.2-1.7 4.8-4.9 4.9-1.3.1-1.6.1-4.8.1s-3.6 0-4.8-.1c-3.3-.1-4.8-1.7-4.9-4.9C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.8C2.4 3.9 3.9 2.4 7.2 2.3 8.4 2.2 8.8 2.2 12 2.2zm0 4.7a5.1 5.1 0 100 10.2 5.1 5.1 0 000-10.2zm0 8.4a3.3 3.3 0 110-6.6 3.3 3.3 0 010 6.6zm5.3-9.8a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4z',
  x: 'M18.2 2.3h3.4l-7.4 8.4 8.7 11.5h-6.8l-5.3-7-6.1 7H1.3l7.9-9L.8 2.3h7l4.8 6.4 5.6-6.4zm-1.2 17.9h1.9L7 4.2H5z',
  facebook: 'M24 12a12 12 0 10-13.9 11.9v-8.4h-3V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0024 12z',
  tiktok: 'M19.6 6.7a4.8 4.8 0 01-3.8-4.2V2h-3.4v13.7a2.9 2.9 0 11-2-2.7V9.5a6.3 6.3 0 105.4 6.2V8.8a8.2 8.2 0 004.8 1.5V6.9a4.8 4.8 0 01-1-.2z',
};

let adminPassword = sessionStorage.getItem('adminPassword');
let images = [];
let current = 0;

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => (k === 'text' ? (node.textContent = v) : node.setAttribute(k, v)));
  node.append(...children);
  return node;
}

function socialLink({ name, url }) {
  const a = el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' });
  const path = ICONS[name.toLowerCase()];
  if (path) {
    a.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
  }
  a.append(name);
  return a;
}

async function loadConfig() {
  const config = await fetch('/api/config').then((r) => r.json());
  document.title = config.name;
  // El nombre se reparte en dos líneas (nombres / apellidos); la segunda va en cursiva.
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

  const stats = Object.entries(config.stats || {});
  $('.stats').classList.toggle('hidden', stats.length === 0);
  $('#stats').replaceChildren(...stats.map(([label, value]) =>
    el('div', {}, [el('dt', { text: label }), el('dd', { text: value })])));

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

async function loadImages() {
  images = await fetch('/api/images').then((r) => r.json());
  // La portada es la elegida en modo edición o, si no hay ninguna, la foto más antigua.
  const cover = images.find((img) => img.cover) || images.at(-1);
  $('#empty').classList.toggle('hidden', images.length > 0);
  $('#gallery').replaceChildren(...images.map((image) => card(image, image === cover)));

  $('#hero-image').replaceChildren(cover
    ? el('img', { src: `/uploads/${cover.file}`, alt: cover.title || '' })
    : el('span', { class: 'placeholder', text: 'Tu foto principal aparecerá aquí' }));
}

function card(image, isCover) {
  const img = el('img', { src: `/uploads/${image.file}`, alt: image.title || 'Imagen del portafolio', loading: 'lazy' });
  const figure = el('figure', { class: 'card', tabindex: '0' }, [img]);
  if (image.title) figure.append(el('figcaption', { text: image.title }));

  if (adminPassword) {
    const del = el('button', { class: 'delete', 'aria-label': 'Eliminar imagen', text: '×' });
    del.addEventListener('click', (e) => {
      e.stopPropagation();
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

  const open = () => openLightbox(images.indexOf(image));
  figure.addEventListener('click', open);
  figure.addEventListener('keydown', (e) => e.key === 'Enter' && open());
  return figure;
}

function openLightbox(index) {
  current = (index + images.length) % images.length;
  const image = images[current];
  $('#lightbox-img').src = `/uploads/${image.file}`;
  $('#lightbox-img').alt = image.title || '';
  $('#lightbox-title').textContent = image.title;
  $('#lightbox-desc').textContent = image.description;
  if (!$('#lightbox').open) $('#lightbox').showModal();
}

$('#lightbox').addEventListener('click', (e) => {
  if (e.target.classList.contains('prev')) openLightbox(current - 1);
  else if (e.target.classList.contains('next')) openLightbox(current + 1);
  else if (e.target.tagName !== 'IMG') $('#lightbox').close();
});
$('#lightbox').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') openLightbox(current - 1);
  if (e.key === 'ArrowRight') openLightbox(current + 1);
});

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

// --- Modo edición ---
function setAdmin(password) {
  adminPassword = password;
  if (password) sessionStorage.setItem('adminPassword', password);
  else sessionStorage.removeItem('adminPassword');
  $('#upload-form').classList.toggle('hidden', !password);
  $('#admin-btn').classList.toggle('active', !!password);
  $('#admin-btn').textContent = password ? 'Salir' : 'Editar';
  loadImages();
}

$('#admin-btn').addEventListener('click', async () => {
  if (adminPassword) return setAdmin(null);
  const password = prompt('Contraseña de administrador:');
  if (!password) return;
  const res = await fetch('/api/login', { method: 'POST', headers: { 'x-admin-password': password } });
  if (res.ok) setAdmin(password);
  else alert('Contraseña incorrecta');
});

// --- Subida de imágenes ---
const form = $('#upload-form');
const fileInput = form.querySelector('input[type=file]');
const dropzone = $('#dropzone');

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
['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, () => dropzone.classList.add('dragover')));
['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, () => dropzone.classList.remove('dragover')));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#upload-msg');
  const button = form.querySelector('button');
  button.disabled = true;
  msg.className = 'msg';
  msg.textContent = 'Subiendo…';

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
    if (res.status === 401) setAdmin(null);
  }
});

// --- Tema claro / oscuro ---
// Sin elección guardada se sigue la preferencia del sistema.
const systemDark = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => (document.documentElement.dataset.theme || (systemDark.matches ? 'dark' : 'light')) === 'dark';
const updateThemeBtn = () => ($('#theme-btn').textContent = isDark() ? 'Claro' : 'Oscuro');

$('#theme-btn').addEventListener('click', () => {
  const theme = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('theme', theme); } catch {}
  updateThemeBtn();
});
systemDark.addEventListener('change', updateThemeBtn);
updateThemeBtn();

$('#year').textContent = new Date().getFullYear();
loadConfig();
setAdmin(adminPassword);
