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
 *   DELETE /api/images/:id         → la borra                   (requiere contraseña)
 *   PUT    /api/images/:id/cover   → la marca como portada      (requiere contraseña)
 *
 *   GET    /api/events             → lista de eventos
 *   POST   /api/events             → publica un evento          (requiere contraseña)
 *   DELETE /api/events/:id         → lo borra                   (requiere contraseña)
 *
 *   GET    /api/shootings          → lista de shootings (portada + collage de 4)
 *   POST   /api/shootings          → publica un shooting        (requiere contraseña)
 *   DELETE /api/shootings/:id      → lo borra con sus 5 imágenes (requiere contraseña)
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

// Quita los datos internos (publicId) antes de enviar las imágenes al navegador.
const toPublic = ({ publicId, ...image }) => image;

// ---------------------------------------------------------------------------
// Colecciones de imágenes sueltas (galería y eventos)
// ---------------------------------------------------------------------------

/**
 * Registra las rutas de una colección: listar, subir y borrar.
 * Galería y eventos funcionan igual, así que comparten este código.
 *
 *   router      → dónde registrar las rutas (p. ej. /api/images)
 *   coll        → operaciones de Cloudinary de la colección (storage.gallery o storage.events)
 *   requireTitle→ si el título es obligatorio (en los eventos sí)
 *
 * Devuelve getItems(), para que otras rutas (como la de portada) usen la misma caché.
 */
function collectionRoutes(router, coll, { requireTitle = false } = {}) {
  const getItems = createCache(() => coll.list());

  router.get('/', async (req, res) => {
    res.json((await getItems()).map(toPublic));
  });

  router.post('/', requireAdmin, upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen' });

    // Recortamos los textos por si alguien envía más de lo que permite el formulario.
    const title = clean(req.body.title, 100);
    const description = clean(req.body.description, 500);
    if (requireTitle && !title) return res.status(400).json({ error: 'El título es obligatorio' });

    // Cargamos la lista ANTES de subir. Si la pidiéramos después (con la caché
    // aún vacía), Cloudinary ya incluiría la imagen nueva y al añadirla abajo
    // quedaría duplicada.
    const items = await getItems();
    const item = await coll.upload(req.file.buffer, { title, description });
    items.unshift(item); // la nueva va al principio (la más reciente primero)
    res.status(201).json(toPublic(item));
  });

  router.delete('/:id', requireAdmin, async (req, res) => {
    const items = await getItems();
    const item = items.find((i) => i.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'No encontrado' });
    await coll.remove(item);
    items.splice(items.indexOf(item), 1);
    res.json({ ok: true });
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
  res.json(JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8')));
});

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

// Eventos: imagen + título (obligatorio) + descripción.
const eventsRouter = express.Router();
collectionRoutes(eventsRouter, storage.events, { requireTitle: true });
app.use('/api/events', eventsRouter);

// Shootings: portada + 4 imágenes para el collage, título (obligatorio) y descripción.
const shootingsRouter = express.Router();
const getShootings = createCache(() => storage.shootings.list());

// Versión pública de un shooting: sin los datos internos de sus imágenes.
const shootingToPublic = (s) => ({ ...s, cover: toPublic(s.cover), images: s.images.map(toPublic) });

shootingsRouter.get('/', async (req, res) => {
  res.json((await getShootings()).map(shootingToPublic));
});

shootingsRouter.post(
  '/',
  requireAdmin,
  // El formulario envía dos campos de archivo: "cover" (1) e "images" (4).
  upload.fields([{ name: 'cover', maxCount: 1 }, { name: 'images', maxCount: 4 }]),
  async (req, res) => {
    const cover = req.files?.cover?.[0];
    const images = req.files?.images || [];
    const title = clean(req.body.title, 100);
    const description = clean(req.body.description, 500);
    if (!cover) return res.status(400).json({ error: 'Falta la imagen de portada' });
    if (images.length !== 4) return res.status(400).json({ error: 'El collage necesita exactamente 4 imágenes' });
    if (!title) return res.status(400).json({ error: 'El título es obligatorio' });

    // Igual que en las colecciones: cargamos la lista antes de subir para no duplicar.
    const list = await getShootings();
    const shooting = await storage.shootings.upload(cover.buffer, images.map((f) => f.buffer), { title, description });
    list.unshift(shooting);
    res.status(201).json(shootingToPublic(shooting));
  },
);

shootingsRouter.delete('/:id', requireAdmin, async (req, res) => {
  const list = await getShootings();
  const shooting = list.find((s) => s.id === req.params.id);
  if (!shooting) return res.status(404).json({ error: 'No encontrado' });
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
