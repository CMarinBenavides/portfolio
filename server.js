import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const CONFIG_FILE = path.join(__dirname, 'data', 'config.json');
const IMAGES_FILE = path.join(__dirname, 'data', 'images.json');
const ALLOWED_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

if (!process.env.ADMIN_PASSWORD) {
  console.warn('⚠  ADMIN_PASSWORD no está definida; se usa "admin". Cámbiala antes de publicar.');
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

const writeImages = (images) => fs.writeFile(IMAGES_FILE, JSON.stringify(images, null, 2));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + ALLOWED_TYPES[file.mimetype]),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES[file.mimetype]) cb(null, true);
    else cb(new Error('Formato no permitido. Usa JPG, PNG, WEBP o GIF.'));
  },
});

// Comparación en tiempo constante para no filtrar la contraseña por tiempos de respuesta.
function requireAdmin(req, res, next) {
  const given = Buffer.from(req.get('x-admin-password') || '');
  const expected = Buffer.from(ADMIN_PASSWORD);
  if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return next();
  res.status(401).json({ error: 'Contraseña incorrecta' });
}

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

app.get('/api/config', async (req, res) => {
  res.json(await readJson(CONFIG_FILE, { name: 'Portafolio', social: [] }));
});

app.get('/api/images', async (req, res) => {
  res.json(await readJson(IMAGES_FILE, []));
});

app.post('/api/login', requireAdmin, (req, res) => res.json({ ok: true }));

app.post('/api/images', requireAdmin, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen' });
  const images = await readJson(IMAGES_FILE, []);
  const image = {
    id: path.parse(req.file.filename).name,
    file: req.file.filename,
    title: (req.body.title || '').trim().slice(0, 100),
    description: (req.body.description || '').trim().slice(0, 500),
    createdAt: new Date().toISOString(),
  };
  images.unshift(image);
  await writeImages(images);
  res.status(201).json(image);
});

// Marca una imagen como portada (solo puede haber una).
app.put('/api/images/:id/cover', requireAdmin, async (req, res) => {
  const images = await readJson(IMAGES_FILE, []);
  if (!images.some((img) => img.id === req.params.id)) {
    return res.status(404).json({ error: 'Imagen no encontrada' });
  }
  await writeImages(images.map((img) => ({ ...img, cover: img.id === req.params.id })));
  res.json({ ok: true });
});

app.delete('/api/images/:id', requireAdmin, async (req, res) => {
  const images = await readJson(IMAGES_FILE, []);
  const image = images.find((img) => img.id === req.params.id);
  if (!image) return res.status(404).json({ error: 'Imagen no encontrada' });
  await fs.rm(path.join(UPLOADS_DIR, image.file), { force: true });
  await writeImages(images.filter((img) => img.id !== image.id));
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  const status = err instanceof multer.MulterError ? 400 : 500;
  const message = err.code === 'LIMIT_FILE_SIZE' ? 'La imagen supera los 10 MB' : err.message;
  res.status(status).json({ error: message });
});

await fs.mkdir(UPLOADS_DIR, { recursive: true });
app.listen(PORT, () => console.log(`Portafolio en http://localhost:${PORT}`));
