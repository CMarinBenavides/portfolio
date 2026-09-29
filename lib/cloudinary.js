/**
 * Módulo de conexión con Cloudinary.
 *
 * Cloudinary es un servicio en la nube para guardar imágenes. Aquí lo usamos
 * para dos cosas a la vez:
 *   1. Guardar los archivos de las fotos (para que no se pierdan si el hosting
 *      borra el disco al reiniciar o al actualizar la aplicación).
 *   2. Guardar los datos de cada foto (título, descripción y si es la portada).
 *      Así no necesitamos ninguna base de datos ni archivos JSON en el servidor.
 *
 * Cómo se organizan las fotos en Cloudinary:
 *   - Todas se suben a una carpeta (por defecto "portfolio").
 *   - Todas llevan la etiqueta (tag) con ese mismo nombre, "portfolio". Las
 *     etiquetas permiten pedirle a Cloudinary "dame todas las fotos del
 *     portafolio" sin importar la configuración de carpetas de la cuenta.
 *   - La foto de portada lleva además la etiqueta "portfolio-cover".
 *   - El título y la descripción se guardan como "contexto" (metadatos de texto
 *     que Cloudinary guarda junto a cada imagen).
 *
 * Este módulo lo usan tanto el servidor (server.js) como el script de
 * migración (scripts/migrar-fotos-locales.js).
 */
import { v2 as cloudinary } from 'cloudinary';

// Carga las variables del archivo .env (claves de Cloudinary, contraseña…) si
// existe. En el hosting normalmente no hay archivo .env: las variables se
// configuran en su panel, y por eso ignoramos el error si falta.
try {
  process.loadEnvFile();
} catch {
  // Sin archivo .env: se usan las variables de entorno del sistema.
}

// Nombre de la carpeta y de la etiqueta que agrupan las fotos del portafolio.
export const FOLDER = process.env.CLOUDINARY_FOLDER || 'portfolio';
const TAG = FOLDER;
const COVER_TAG = `${FOLDER}-cover`;

// Comprobamos al arrancar que están las tres claves necesarias. Si falta alguna
// es mejor detenerse con un mensaje claro que fallar más tarde al subir una foto.
const missing = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']
  .filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`✖  Faltan variables de Cloudinary: ${missing.join(', ')}`);
  console.error('   Copia .env.example como .env y rellena tus claves (ver README.md).');
  process.exit(1);
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true, // genera siempre direcciones https://
});

/**
 * Construye la dirección web de una foto con un tamaño máximo dado.
 *
 * Cloudinary transforma la imagen "al vuelo" según lo que pidamos en la URL:
 *   - width + crop "limit": la reduce a ese ancho como máximo (nunca la agranda).
 *   - fetch_format "auto": entrega el formato más ligero que soporte el
 *     navegador del visitante (AVIF o WebP en vez de JPG, por ejemplo).
 *   - quality "auto": ajusta la compresión sin pérdida visible de calidad.
 * El resultado se guarda en la red de Cloudinary (CDN), así que solo se calcula
 * la primera vez y luego se sirve muy rápido desde el servidor más cercano.
 */
function imageUrl(resource, width) {
  return cloudinary.url(resource.public_id, {
    version: resource.version, // cambia si se reemplaza la imagen, para evitar cachés viejas
    width,
    crop: 'limit',
    fetch_format: 'auto',
    quality: 'auto',
  });
}

/**
 * Convierte la respuesta de Cloudinary en el objeto sencillo que recibe la web.
 * Así el navegador no necesita saber nada de Cloudinary.
 */
export function toImage(resource) {
  const context = resource.context?.custom || {};
  return {
    id: resource.asset_id, // identificador único y sin barras, cómodo para las URLs de la API
    publicId: resource.public_id, // nombre interno en Cloudinary; lo usa solo el servidor
    title: context.title || '',
    description: context.description || '',
    cover: (resource.tags || []).includes(COVER_TAG),
    createdAt: resource.created_at,
    thumb: imageUrl(resource, 900), // versión mediana para la galería
    full: imageUrl(resource, 2000), // versión grande para el visor y la portada
  };
}

/**
 * Descarga de Cloudinary la lista completa de fotos del portafolio,
 * ordenadas de la más reciente a la más antigua.
 */
export async function listImages() {
  const resources = [];
  let cursor;
  // Cloudinary devuelve los resultados por páginas de hasta 500 elementos;
  // "next_cursor" indica que quedan más páginas por pedir.
  do {
    const page = await cloudinary.api.resources_by_tag(TAG, {
      context: true, // incluir título y descripción
      tags: true, // incluir etiquetas (para saber cuál es la portada)
      max_results: 500,
      next_cursor: cursor,
    });
    resources.push(...page.resources);
    cursor = page.next_cursor;
  } while (cursor);

  return resources
    .map(toImage)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Sube una foto a Cloudinary a partir de su contenido en memoria (un Buffer).
 * Devuelve la foto ya convertida con toImage().
 */
export function uploadImage(buffer, { title = '', description = '', cover = false } = {}) {
  // La librería de Cloudinary sube los datos en forma de "stream" y avisa con
  // un callback; lo envolvemos en una Promise para poder usar await.
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: FOLDER,
        tags: cover ? [TAG, COVER_TAG] : [TAG],
        context: { title, description },
        resource_type: 'image',
      },
      (error, result) => (error ? reject(error) : resolve(toImage(result))),
    );
    stream.end(buffer);
  });
}

/**
 * Marca una foto como portada y se la quita a las demás
 * (solo puede haber una portada a la vez).
 */
export async function setCover(image, allImages) {
  const previous = allImages.filter((img) => img.cover && img.id !== image.id);
  if (previous.length) {
    await cloudinary.uploader.remove_tag(COVER_TAG, previous.map((img) => img.publicId));
  }
  await cloudinary.uploader.add_tag(COVER_TAG, [image.publicId]);
}

/**
 * Borra una foto de Cloudinary.
 * "invalidate" pide a la CDN que olvide las copias guardadas, para que la foto
 * deje de verse cuanto antes.
 */
export async function deleteImage(image) {
  const { result } = await cloudinary.uploader.destroy(image.publicId, { invalidate: true });
  // "not found" significa que ya no existía: para nosotros también es un éxito.
  if (result !== 'ok' && result !== 'not found') {
    throw new Error(`Cloudinary no pudo borrar la imagen (${result})`);
  }
}
