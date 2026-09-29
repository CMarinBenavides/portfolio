/**
 * Script de migración: sube a Cloudinary las fotos que se guardaron en local
 * con la versión anterior del proyecto (carpeta uploads/ + data/images.json).
 *
 * Uso (una sola vez, después de configurar el archivo .env):
 *   npm run migrar
 *
 * - Conserva el título, la descripción y cuál era la portada.
 * - NO borra los archivos locales: cuando compruebes que las fotos se ven bien
 *   en la web, puedes borrar uploads/ y data/images.json a mano.
 * - Si lo ejecutas dos veces, las fotos se subirán repetidas.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { uploadImage } from '../lib/cloudinary.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const listFile = path.join(root, 'data', 'images.json');

let images;
try {
  images = JSON.parse(await fs.readFile(listFile, 'utf8'));
} catch {
  console.log('No hay fotos locales que migrar (no existe data/images.json).');
  process.exit(0);
}

// La lista local tiene la foto más reciente primero. Las subimos de la más
// antigua a la más nueva para que en Cloudinary conserven el mismo orden.
let migrated = 0;
for (const image of images.toReversed()) {
  const file = path.join(root, 'uploads', image.file);
  try {
    const buffer = await fs.readFile(file);
    await uploadImage(buffer, {
      title: image.title,
      description: image.description,
      cover: Boolean(image.cover),
    });
    migrated++;
    console.log(`✔  ${image.title || image.file}`);
  } catch (error) {
    console.error(`✖  ${image.title || image.file}: ${error.message}`);
  }
}

console.log(`\nMigradas ${migrated} de ${images.length} fotos.`);
console.log('Los archivos locales se han conservado; bórralos cuando compruebes que todo está bien.');
