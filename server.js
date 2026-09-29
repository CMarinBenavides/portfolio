/**
 * Servidor del portafolio.
 *
 * Hace tres cosas:
 *   1. Sirve la página web (los archivos de la carpeta public/).
 *   2. Ofrece una pequeña API para que la página lea los datos del perfil y la
 *      lista de fotos.
 *   3. Permite, con contraseña, subir fotos, borrarlas y elegir la portada.
 *      Las fotos se guardan en Cloudinary (ver lib/cloudinary.js).
 *
 * Rutas de la API:
 *   GET    /api/config             → nombre, biografía, medidas y redes (data/config.json)
 *   GET    /api/images             → lista de fotos
 *   POST   /api/login              → comprueba la contraseña de administrador
 *   POST   /api/images             → sube una foto          (requiere contraseña)
 *   PUT    /api/images/:id/cover   → la marca como portada  (requiere contraseña)
 *   DELETE /api/images/:id         → la borra               (requiere contraseña)
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
// Caché de la lista de fotos
// ---------------------------------------------------------------------------
// Pedirle la lista a Cloudinary en cada visita sería lento y además su plan
// gratuito limita cuántas consultas de este tipo se pueden hacer por hora.
// Por eso la pedimos una sola vez y la guardamos en memoria. Cuando subimos,
// borramos o cambiamos la portada, actualizamos esa copia a mano.
// Si se reinicia el servidor, la copia se vuelve a pedir en la primera visita.
let imagesCache = null;

async function getImages() {
  // Guardamos la Promise (no el resultado) para que, si llegan varias visitas a
  // la vez justo al arrancar, todas esperen la misma consulta en vez de lanzar varias.
  imagesCache ??= storage.listImages().catch((error) => {
    imagesCache = null; // si falla, lo reintentamos en la siguiente visita
    throw error;
  });
  return imagesCache;
}

// Quita los datos internos (publicId) antes de enviar las fotos al navegador.
const toPublic = ({ publicId, ...image }) => image;

// Busca una foto por su id o responde 404 si no existe.
async function findImage(req, res) {
  const images = await getImages();
  const image = images.find((img) => img.id === req.params.id);
  if (!image) res.status(404).json({ error: 'Imagen no encontrada' });
  return image;
}

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

app.get('/api/images', async (req, res) => {
  res.json((await getImages()).map(toPublic));
});

// Solo sirve para que la página compruebe la contraseña al entrar en modo edición.
app.post('/api/login', requireAdmin, (req, res) => res.json({ ok: true }));

app.post('/api/images', requireAdmin, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen' });

  // Cargamos la lista ANTES de subir. Si la pidiéramos después (con la caché
  // aún vacía), Cloudinary ya incluiría la foto nueva y al añadirla abajo
  // quedaría duplicada.
  const images = await getImages();
  const image = await storage.uploadImage(req.file.buffer, {
    // Recortamos los textos por si alguien envía más de lo que permite el formulario.
    title: (req.body.title || '').trim().slice(0, 100),
    description: (req.body.description || '').trim().slice(0, 500),
  });

  // La foto nueva va al principio de la lista (la más reciente primero).
  images.unshift(image);
  res.status(201).json(toPublic(image));
});

app.put('/api/images/:id/cover', requireAdmin, async (req, res) => {
  const image = await findImage(req, res);
  if (!image) return;
  const images = await getImages();
  await storage.setCover(image, images);
  images.forEach((img) => (img.cover = img.id === image.id));
  res.json({ ok: true });
});

app.delete('/api/images/:id', requireAdmin, async (req, res) => {
  const image = await findImage(req, res);
  if (!image) return;
  await storage.deleteImage(image);
  const images = await getImages();
  images.splice(images.indexOf(image), 1);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Manejo de errores
// ---------------------------------------------------------------------------
// Cualquier error en las rutas de arriba llega aquí (Express 5 captura también
// los errores de las funciones async). Respondemos siempre en JSON con un
// mensaje entendible para mostrarlo en la página.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message?.startsWith('Formato no permitido')) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'La imagen supera los 10 MB' : err.message;
    return res.status(400).json({ error: message });
  }
  console.error(err);
  res.status(500).json({ error: 'Error del servidor. Inténtalo de nuevo.' });
});

app.listen(PORT, () => console.log(`Portafolio en http://localhost:${PORT}`));
