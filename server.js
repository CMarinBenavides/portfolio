/**
 * Servidor del portafolio.
 *
 * Hace tres cosas:
 *   1. Sirve la página web (los archivos de la carpeta public/).
 *   2. Ofrece una pequeña API para que la página lea los datos del perfil y
 *      las listas de fotos, eventos y shootings.
 *   3. Permite, con contraseña, subir y borrar fotos, eventos y shootings, y
 *      elegir la portada. Las imágenes se guardan en Cloudinary (ver lib/cloudinary.js).
 *
 * Rutas de la API:
 *   GET    /api/config             → nombre, biografía, medidas y redes (data/config.json)
 *   POST   /api/login              → comprueba la contraseña de administrador
 *
 *   GET    /api/images             → lista de fotos de la galería
 *   POST   /api/images             → sube una foto              (requiere contraseña)
 *   PUT    /api/images/:id         → edita su título y descripción (requiere contraseña)
 *   DELETE /api/images/:id         → la borra                   (requiere contraseña)
 *   PUT    /api/images/:id/cover   → la marca como portada      (requiere contraseña)
 *   PUT    /api/images/:id/focus   → guarda su encuadre en la portada { x, y, zoom } (requiere contraseña)
 *
 *   GET    /api/events             → lista de eventos (de 1 a 3 fotos con leyenda, logo, textos y créditos)
 *   POST   /api/events             → publica un evento          (requiere contraseña)
 *   PUT    /api/events/:id         → lo edita: textos, leyendas, fotos y logo (requiere contraseña)
 *   DELETE /api/events/:id         → lo borra con todas sus imágenes (requiere contraseña)
 *   PUT    /api/events/:id/images/:imageId/focus → encuadre de una foto { x, y, zoom } (requiere contraseña)
 *
 *   GET    /api/polaroids          → lista de polaroids (4 como máximo)
 *   POST   /api/polaroids          → sube una o varias (campo "image", hasta completar 4) (requiere contraseña)
 *   DELETE /api/polaroids/:id      → borra una                  (requiere contraseña)
 *   PUT    /api/polaroids/order    → cambia el orden { ids: [...] } (requiere contraseña)
 *   PUT    /api/polaroids/:id/focus→ guarda su encuadre { x, y, zoom } (requiere contraseña)
 *
 *   GET    /api/shootings          → lista de shootings (portada + páginas de collage de 4)
 *   POST   /api/shootings          → publica el shooting (solo se permite uno) (requiere contraseña)
 *   PUT    /api/shootings/:id      → lo edita: textos, portada, orden de imágenes y páginas nuevas (requiere contraseña)
 *   DELETE /api/shootings/:id/pages/:n → quita la página n del collage (requiere contraseña)
 *   DELETE /api/shootings/:id      → lo borra con todas sus imágenes (requiere contraseña)
 */
import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Al importar este módulo también se carga el archivo .env y se configura Cloudinary.
import * as storage from './lib/cloudinary.js';

// Carpeta donde está este archivo, para construir rutas que funcionen
// sin importar desde qué carpeta se arranque el servidor.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Puerto en el que escucha el servidor. Los hostings suelen indicarlo con la
// variable PORT; en tu computador se usa el 3000.
const PORT = process.env.PORT || 3000;

// Contraseña para el modo edición. Se define en .env o en el panel del hosting.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
if (!process.env.ADMIN_PASSWORD) {
  console.warn('⚠  ADMIN_PASSWORD no está definida; se usa "admin". Cámbiala antes de publicar.');
}

const CONFIG_FILE = path.join(__dirname, 'data', 'config.json');

// Tipos de imagen que aceptamos (el navegador informa el tipo de cada archivo).
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// ---------------------------------------------------------------------------
// Recepción de archivos
// ---------------------------------------------------------------------------
// Multer se encarga de leer el archivo que envía el formulario. Lo guardamos en
// memoria (no en disco) porque enseguida lo reenviamos a Cloudinary.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB, el máximo del plan gratuito de Cloudinary
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Formato no permitido. Usa JPG, PNG, WEBP o GIF.'));
  },
});

// ---------------------------------------------------------------------------
// Protección con contraseña
// ---------------------------------------------------------------------------
// Las rutas que modifican el portafolio exigen la cabecera "x-admin-password".
// Usamos timingSafeEqual para comparar: tarda lo mismo acierte o no, y así un
// atacante no puede adivinar la contraseña midiendo tiempos de respuesta.
function requireAdmin(req, res, next) {
  const given = Buffer.from(req.get('x-admin-password') || '');
  const expected = Buffer.from(ADMIN_PASSWORD);
  if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return next();
  res.status(401).json({ error: 'Contraseña incorrecta' });
}

// ---------------------------------------------------------------------------
// Caché de listas en memoria
// ---------------------------------------------------------------------------
// Pedirle las listas a Cloudinary en cada visita sería lento y además su plan
// gratuito limita cuántas consultas de este tipo se pueden hacer por hora.
// Por eso cada lista se pide una sola vez y se guarda. Al subir o borrar,
// actualizamos esa copia a mano. Si se reinicia el servidor, se vuelve a pedir
// en la primera visita.
function createCache(load) {
  let cache = null;
  return function get() {
    // Guardamos la Promise (no el resultado) para que, si llegan varias visitas
    // a la vez justo al arrancar, todas esperen la misma consulta.
    cache ??= load().catch((error) => {
      cache = null; // si falla, lo reintentamos en la siguiente visita
      throw error;
    });
    return cache;
  };
}

// Recorta un texto enviado por el formulario a una longitud máxima.
const clean = (text, max) => (text || '').trim().slice(0, max);

/**
 * Lee un encuadre enviado como JSON { x, y, zoom }: dos porcentajes entre 0 y
 * 100 y el zoom, entre 1 y 3. Devuelve null si no es válido. Redondeamos:
 * suficiente precisión y un texto corto en Cloudinary.
 */
function readFocus(body) {
  const x = Number(body?.x);
  const y = Number(body?.y);
  const zoom = Number(body?.zoom ?? 1);
  const valid = (n) => Number.isFinite(n) && n >= 0 && n <= 100;
  if (!valid(x) || !valid(y) || !(zoom >= 1 && zoom <= 3)) return null;
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, zoom: Math.round(zoom * 100) / 100 };
}

// Quita los datos internos (publicId) antes de enviar las imágenes al navegador.
const toPublic = ({ publicId, ...image }) => image;

// ---------------------------------------------------------------------------
// Colecciones de imágenes sueltas (galería y polaroids)
// ---------------------------------------------------------------------------

/**
 * Registra las rutas de una colección: listar, subir, editar textos, borrar y encuadrar.
 * La galería y las polaroids funcionan igual, así que comparten este código.
 *
 *   router      → dónde registrar las rutas (p. ej. /api/images)
 *   coll        → operaciones de Cloudinary de la colección (storage.gallery o storage.polaroids)
 *   max         → número máximo de imágenes de la colección (las polaroids son 4);
 *                 si no se indica, no hay límite
 *   ordered     → si el orden lo decide la persona (polaroids) en vez de la fecha;
 *                 añade la ruta PUT /order para cambiarlo
 *
 * Devuelve getItems(), para que otras rutas (como la de portada) usen la misma caché.
 */
function collectionRoutes(router, coll, { max = 0, ordered = false } = {}) {
  // En las colecciones con orden propio, la lista se ordena por la posición
  // guardada ("order"); las que no la tengan van al final, de la más antigua a la más nueva.
  const byOrder = (a, b) =>
    (a.order ?? Infinity) - (b.order ?? Infinity) || new Date(a.createdAt) - new Date(b.createdAt);
  const getItems = createCache(async () => {
    const items = await coll.list();
    return ordered ? items.sort(byOrder) : items;
  });

  router.get('/', async (req, res) => {
    res.json((await getItems()).map(toPublic));
  });

  // Se pueden enviar varias imágenes de una vez solo si la colección tiene un
  // máximo (las polaroids); la galería y los eventos reciben una sola.
  router.post('/', requireAdmin, upload.array('image', max || 1), async (req, res) => {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No se recibió ninguna imagen' });

    // Recortamos los textos por si alguien envía más de lo que permite el formulario.
    const title = clean(req.body.title, 100);
    const description = clean(req.body.description, 500);

    // Cargamos la lista ANTES de subir. Si la pidiéramos después (con la caché
    // aún vacía), Cloudinary ya incluiría la imagen nueva y al añadirla abajo
    // quedaría duplicada.
    const items = await getItems();
    if (max && items.length + files.length > max) {
      const free = max - items.length;
      return res.status(400).json({
        error: free > 0
          ? `Solo caben ${max} imágenes. Puedes añadir ${free} más.`
          : `Ya hay ${max} imágenes. Borra alguna para añadir otra.`,
      });
    }
    // Con orden propio, las nuevas van detrás de la última posición usada.
    let nextOrder = Math.max(-1, ...items.map((i) => i.order ?? -1)) + 1;
    // Una por una (y no todas a la vez) para que conserven el orden en que se eligieron.
    const created = [];
    for (const file of files) {
      const item = await coll.upload(file.buffer, { title, description, ...(ordered && { order: nextOrder++ }) });
      // Con orden propio la nueva va al final; si no, al principio (la más reciente primero).
      if (ordered) items.push(item);
      else items.unshift(item);
      created.push(item);
    }
    res.status(201).json(created.map(toPublic));
  });

  router.delete('/:id', requireAdmin, async (req, res) => {
    const items = await getItems();
    const item = items.find((i) => i.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'No encontrado' });
    await coll.remove(item);
    items.splice(items.indexOf(item), 1);
    res.json({ ok: true });
  });

  // Cambiar el orden (solo colecciones con orden propio). Recibe JSON
  // { ids: [...] } con TODOS los identificadores en el orden nuevo. Se
  // registra antes que PUT /:id para que "order" no se tome por un id.
  if (ordered) {
    router.put('/order', requireAdmin, express.json(), async (req, res) => {
      const items = await getItems();
      const ids = req.body?.ids;
      // Comprobamos que la lista tiene exactamente las mismas imágenes, sin repetir ni faltar ninguna.
      const valid = Array.isArray(ids) && ids.length === items.length && new Set(ids).size === ids.length &&
        ids.every((id) => items.some((i) => i.id === id));
      if (!valid) return res.status(400).json({ error: 'El orden enviado no es válido. Recarga la página e inténtalo de nuevo.' });
      const sorted = ids.map((id) => items.find((i) => i.id === id));
      await storage.setOrder(sorted);
      sorted.forEach((item, i) => (item.order = i));
      items.splice(0, items.length, ...sorted); // actualizamos la caché
      res.json({ ok: true });
    });
  }

  // Editar los textos (título y descripción) de una imagen ya publicada.
  // Recibe JSON { title, description }.
  router.put('/:id', requireAdmin, express.json(), async (req, res) => {
    const items = await getItems();
    const item = items.find((i) => i.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'No encontrado' });
    const title = clean(req.body?.title, 100);
    const description = clean(req.body?.description, 500);
    await storage.setTexts(item, { title, description });
    Object.assign(item, { title, description }); // actualizamos la caché
    res.json(toPublic(item));
  });

  // Encuadre de la imagen: qué parte se ve cuando se recorta para llenar su
  // marco (la foto principal del inicio o una polaroid). Recibe JSON
  // { x, y, zoom } (ver readFocus; express.json() lee el cuerpo de la petición).
  router.put('/:id/focus', requireAdmin, express.json(), async (req, res) => {
    const items = await getItems();
    const item = items.find((i) => i.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'No encontrado' });
    const focus = readFocus(req.body);
    if (!focus) return res.status(400).json({ error: 'Encuadre no válido' });
    await storage.setFocus(item, focus);
    item.focus = focus; // actualizamos la caché
    res.json({ ok: true, focus });
  });

  return getItems;
}

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------
const app = express();

// Archivos de la página (index.html, styles.css, app.js).
app.use(express.static(path.join(__dirname, 'public')));

// Datos del perfil. Se leen del archivo en cada petición para que los cambios
// en config.json se vean sin reiniciar el servidor.
app.get('/api/config', async (req, res) => {
  const config = JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8'));
  res.json({ ...config, google: googleConfig() });
});

/**
 * Claves de Google para elegir fotos desde Google Drive (ver README.md).
 * Estas tres claves son PÚBLICAS por diseño: el selector de Google se ejecuta en
 * el navegador y las necesita allí. (La protección la da Google: la clave de API
 * se restringe a tu dominio y cada persona inicia sesión con su propia cuenta.)
 * Si falta alguna, devolvemos null y la página no muestra el botón de Drive.
 */
function googleConfig() {
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_API_KEY: apiKey, GOOGLE_APP_ID: appId } = process.env;
  return clientId && apiKey && appId ? { clientId, apiKey, appId } : null;
}

// Solo sirve para que la página compruebe la contraseña al entrar en modo edición.
app.post('/api/login', requireAdmin, (req, res) => res.json({ ok: true }));

// Galería de fotos, con la ruta extra para elegir la portada.
const imagesRouter = express.Router();
const getImages = collectionRoutes(imagesRouter, storage.gallery);
imagesRouter.put('/:id/cover', requireAdmin, async (req, res) => {
  const images = await getImages();
  const image = images.find((img) => img.id === req.params.id);
  if (!image) return res.status(404).json({ error: 'Imagen no encontrada' });
  await storage.setCover(image, images);
  images.forEach((img) => (img.cover = img.id === image.id));
  res.json({ ok: true });
});
app.use('/api/images', imagesRouter);

// Eventos: de 1 a 3 fotos con leyenda, logo opcional, título (obligatorio),
// fecha, detalle, descripción y 3 créditos.
const EVENT_MAX_PHOTOS = 3;
const eventsRouter = express.Router();
const getEvents = createCache(() => storage.events.list());

// Versión pública de un evento: sin los datos internos de sus imágenes.
const eventToPublic = (e) => ({ ...e, images: e.images.map(toPublic), logo: e.logo && toPublic(e.logo) });

// El formulario envía "images" (las fotos) y "logo" (opcional).
const eventFiles = upload.fields([
  { name: 'images', maxCount: EVENT_MAX_PHOTOS },
  { name: 'logo', maxCount: 1 },
]);

// Lee y recorta los textos del evento enviados por el formulario.
function readEventTexts(body) {
  return {
    title: clean(body.title, 100),
    date: clean(body.date, 40),
    detail: clean(body.detail, 80),
    description: clean(body.description, 400),
    credits: [1, 2, 3].map((n) => ({ label: clean(body[`credit${n}Label`], 40), value: clean(body[`credit${n}Value`], 60) })),
  };
}

// Leyenda de cada foto nueva: campos legend0 / place0, legend1 / place1…
// (en el mismo orden que los archivos).
const readCaption = (body, i) => ({ legend: clean(body[`legend${i}`], 80), place: clean(body[`place${i}`], 80) });

const PHOTOS_ERROR = `Cada evento lleva de 1 a ${EVENT_MAX_PHOTOS} fotos.`;

// Busca un evento por su id (o responde 404).
async function findEvent(req, res) {
  const list = await getEvents();
  const event = list.find((e) => e.id === req.params.id);
  if (!event) res.status(404).json({ error: 'No encontrado' });
  return { list, event };
}

eventsRouter.get('/', async (req, res) => {
  res.json((await getEvents()).map(eventToPublic));
});

eventsRouter.post('/', requireAdmin, eventFiles, async (req, res) => {
  const files = req.files?.images || [];
  const texts = readEventTexts(req.body);
  if (!texts.title) return res.status(400).json({ error: 'El título es obligatorio' });
  if (files.length < 1 || files.length > EVENT_MAX_PHOTOS) return res.status(400).json({ error: PHOTOS_ERROR });

  const list = await getEvents(); // antes de subir, para no duplicar (ver collectionRoutes)
  const photos = files.map((f, i) => ({ buffer: f.buffer, ...readCaption(req.body, i) }));
  const event = await storage.events.upload(texts, photos, req.files?.logo?.[0]?.buffer);
  list.unshift(event);
  res.status(201).json(eventToPublic(event));
});

// Editar un evento: los textos siempre; las fotos nuevas de "images" se
// AÑADEN; "keep" dice qué fotos actuales se conservan y con qué leyenda
// (JSON [{ id, legend, place }]); las que no aparecen se quitan. El logo se
// cambia si se envía uno nuevo, o se quita con removeLogo = "1".
eventsRouter.put('/:id', requireAdmin, eventFiles, async (req, res) => {
  const { list, event } = await findEvent(req, res);
  if (!event) return;
  const texts = readEventTexts(req.body);
  if (!texts.title) return res.status(400).json({ error: 'El título es obligatorio' });

  let keepData;
  try {
    keepData = JSON.parse(req.body.keep || '[]');
  } catch {
    return res.status(400).json({ error: 'Datos de fotos no válidos' });
  }
  const byId = new Map(event.images.map((img) => [img.id, img]));
  if (!Array.isArray(keepData) || new Set(keepData.map((k) => k?.id)).size !== keepData.length ||
      keepData.some((k) => !byId.has(k?.id))) {
    return res.status(400).json({ error: 'Datos de fotos no válidos' });
  }
  const files = req.files?.images || [];
  const total = keepData.length + files.length;
  if (total < 1 || total > EVENT_MAX_PHOTOS) return res.status(400).json({ error: PHOTOS_ERROR });

  const updated = await storage.events.update(event, {
    texts,
    keep: keepData.map((k) => ({ image: byId.get(k.id), legend: clean(k.legend, 80), place: clean(k.place, 80) })),
    add: files.map((f, i) => ({ buffer: f.buffer, ...readCaption(req.body, i) })),
    logoBuffer: req.files?.logo?.[0]?.buffer,
    removeLogo: req.body.removeLogo === '1',
  });
  list[list.indexOf(event)] = updated; // actualizamos la caché
  res.json(eventToPublic(updated));
});

eventsRouter.delete('/:id', requireAdmin, async (req, res) => {
  const { list, event } = await findEvent(req, res);
  if (!event) return;
  await storage.events.remove(event);
  list.splice(list.indexOf(event), 1);
  res.json({ ok: true });
});

// Encuadre de una foto del evento: JSON { x, y, zoom } (como en las demás colecciones).
eventsRouter.put('/:id/images/:imageId/focus', requireAdmin, express.json(), async (req, res) => {
  const { event } = await findEvent(req, res);
  if (!event) return;
  const image = event.images.find((img) => img.id === req.params.imageId);
  if (!image) return res.status(404).json({ error: 'No encontrado' });
  const focus = readFocus(req.body);
  if (!focus) return res.status(400).json({ error: 'Encuadre no válido' });
  await storage.setFocus(image, focus);
  image.focus = focus;
  res.json({ ok: true, focus });
});

app.use('/api/events', eventsRouter);

// Polaroids: hasta 4 fotos con marco, que se muestran en una cuadrícula de 2 × 2.
const POLAROIDS_MAX = 4;
const polaroidsRouter = express.Router();
collectionRoutes(polaroidsRouter, storage.polaroids, { max: POLAROIDS_MAX, ordered: true });
app.use('/api/polaroids', polaroidsRouter);

// Shootings: portada + páginas de collage de 4 imágenes, título (obligatorio),
// subtítulo y descripción. Solo se permite un shooting publicado a la vez.
const shootingsRouter = express.Router();
const getShootings = createCache(() => storage.shootings.list());

const { PAGE_SIZE } = storage;
const MAX_PAGES = 10; // páginas de collage como máximo por shooting
const MAX_PAGES_PER_UPLOAD = 5; // páginas que se pueden subir de una vez (20 imágenes)

// Versión pública de un shooting: sin los datos internos de sus imágenes.
const shootingToPublic = (s) => ({ ...s, cover: toPublic(s.cover), images: s.images.map(toPublic) });

// El formulario envía dos campos de archivo: "cover" (1) e "images" (4, 8, 12…).
const shootingFiles = upload.fields([
  { name: 'cover', maxCount: 1 },
  { name: 'images', maxCount: PAGE_SIZE * MAX_PAGES_PER_UPLOAD },
]);

// Comprueba que el número de imágenes del collage forme páginas completas de 4.
const incompletePages = (count) => count % PAGE_SIZE !== 0;
const PAGES_ERROR = `Las imágenes del collage van de ${PAGE_SIZE} en ${PAGE_SIZE} (una página): elige 4, 8, 12…`;

// Busca un shooting por su id (o responde 404).
async function findShooting(req, res) {
  const list = await getShootings();
  const shooting = list.find((s) => s.id === req.params.id);
  if (!shooting) res.status(404).json({ error: 'No encontrado' });
  return { list, shooting };
}

shootingsRouter.get('/', async (req, res) => {
  res.json((await getShootings()).map(shootingToPublic));
});

shootingsRouter.post('/', requireAdmin, shootingFiles, async (req, res) => {
  const cover = req.files?.cover?.[0];
  const images = req.files?.images || [];
  const title = clean(req.body.title, 100);
  const subtitle = clean(req.body.subtitle, 100);
  const description = clean(req.body.description, 500);
  if (!cover) return res.status(400).json({ error: 'Falta la imagen de portada' });
  if (!images.length || incompletePages(images.length)) return res.status(400).json({ error: PAGES_ERROR });
  if (!title) return res.status(400).json({ error: 'El título es obligatorio' });

  // Igual que en las colecciones: cargamos la lista antes de subir para no duplicar.
  const list = await getShootings();
  if (list.length > 0) {
    return res.status(409).json({ error: 'Ya hay un shooting publicado. Bórralo para añadir otro.' });
  }
  const shooting = await storage.shootings.upload(cover.buffer, images.map((f) => f.buffer), { title, subtitle, description });
  list.unshift(shooting);
  res.status(201).json(shootingToPublic(shooting));
});

// Editar el shooting: los textos siempre; la portada solo si se envía una
// nueva; las imágenes de "images" se AÑADEN como páginas nuevas al final; y,
// si se envía "order", las imágenes actuales se reordenan o se quitan.
//   order → JSON con los ids de las imágenes actuales que se conservan, en su
//           nuevo orden. Las que no aparecen se quitan del shooting.
shootingsRouter.put('/:id', requireAdmin, shootingFiles, async (req, res) => {
  const { list, shooting } = await findShooting(req, res);
  if (!shooting) return;

  const cover = req.files?.cover?.[0];
  const images = req.files?.images || [];
  const title = clean(req.body.title, 100);
  if (!title) return res.status(400).json({ error: 'El título es obligatorio' });
  if (incompletePages(images.length)) return res.status(400).json({ error: PAGES_ERROR });

  // Nuevo orden (opcional). Comprobamos que solo contenga imágenes de este
  // shooting y sin repetir.
  let order = shooting.images;
  if (req.body.order !== undefined) {
    let ids;
    try {
      ids = JSON.parse(req.body.order);
    } catch {
      return res.status(400).json({ error: 'Orden no válido' });
    }
    const byId = new Map(shooting.images.map((img) => [img.id, img]));
    if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some((id) => !byId.has(id))) {
      return res.status(400).json({ error: 'Orden no válido' });
    }
    order = ids.map((id) => byId.get(id));
  }
  const removed = shooting.images.filter((img) => !order.includes(img));

  // Todas las páginas deben quedar completas (4 imágenes cada una).
  if (incompletePages(order.length)) {
    return res.status(400).json({ error: 'Cada página del collage necesita 4 imágenes.' });
  }
  const pages = (order.length + images.length) / PAGE_SIZE;
  if (pages < 1) return res.status(400).json({ error: 'El collage debe tener al menos una página.' });
  if (pages > MAX_PAGES) {
    return res.status(400).json({ error: `Un shooting puede tener como máximo ${MAX_PAGES} páginas de collage.` });
  }

  const updated = await storage.shootings.update(shooting, {
    title,
    subtitle: clean(req.body.subtitle, 100),
    description: clean(req.body.description, 500),
    coverBuffer: cover?.buffer,
    addImageBuffers: images.map((f) => f.buffer),
    order,
    removed,
  });
  list[list.indexOf(shooting)] = updated; // actualizamos la caché
  res.json(shootingToPublic(updated));
});

// Quitar una página del collage (sus 4 imágenes). ":page" empieza en 1.
// Siempre debe quedar al menos una página.
shootingsRouter.delete('/:id/pages/:page', requireAdmin, async (req, res) => {
  const { list, shooting } = await findShooting(req, res);
  if (!shooting) return;
  const pages = Math.ceil(shooting.images.length / PAGE_SIZE);
  const page = Number(req.params.page);
  if (!Number.isInteger(page) || page < 1 || page > pages) return res.status(404).json({ error: 'Página no encontrada' });
  if (pages === 1) return res.status(400).json({ error: 'El collage debe tener al menos una página.' });

  const updated = await storage.shootings.removePage(shooting, page);
  list[list.indexOf(shooting)] = updated;
  res.json(shootingToPublic(updated));
});

shootingsRouter.delete('/:id', requireAdmin, async (req, res) => {
  const { list, shooting } = await findShooting(req, res);
  if (!shooting) return;
  await storage.shootings.remove(shooting);
  list.splice(list.indexOf(shooting), 1);
  res.json({ ok: true });
});
app.use('/api/shootings', shootingsRouter);

// ---------------------------------------------------------------------------
// Manejo de errores
// ---------------------------------------------------------------------------
// Cualquier error en las rutas de arriba llega aquí (Express 5 captura también
// los errores de las funciones async). Respondemos siempre en JSON con un
// mensaje entendible para mostrarlo en la página.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message?.startsWith('Formato no permitido')) {
    const message = {
      LIMIT_FILE_SIZE: 'Alguna imagen supera los 10 MB',
      LIMIT_UNEXPECTED_FILE: 'Se enviaron más imágenes de las permitidas',
    }[err.code] || err.message;
    return res.status(400).json({ error: message });
  }
  console.error(err);
  res.status(500).json({ error: 'Error del servidor. Inténtalo de nuevo.' });
});

app.listen(PORT, () => console.log(`Portafolio en http://localhost:${PORT}`));
