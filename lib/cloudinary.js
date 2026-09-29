/**
 * Módulo de conexión con Cloudinary.
 *
 * Cloudinary es un servicio en la nube para guardar imágenes. Aquí lo usamos
 * para dos cosas a la vez:
 *   1. Guardar los archivos de las imágenes (para que no se pierdan si el
 *      hosting borra el disco al reiniciar o al actualizar la aplicación).
 *   2. Guardar los datos de cada imagen (título, descripción y si es la
 *      portada). Así no necesitamos ninguna base de datos ni archivos JSON.
 *
 * Hay tres "colecciones" de imágenes, que no se mezclan entre sí:
 *   - gallery: las fotos del portafolio.
 *       carpeta "portfolio", etiqueta "portfolio".
 *       La foto de portada lleva además la etiqueta "portfolio-cover".
 *   - events: los eventos (imagen + título + descripción).
 *       carpeta "portfolio/eventos", etiqueta "portfolio-events".
 *   - shootings: grupos de 5 imágenes (portada + collage de 4), con título y
 *       descripción. Carpeta "portfolio/shootings", etiqueta "portfolio-shootings".
 *
 * Las etiquetas (tags) permiten pedirle a Cloudinary "dame todas las imágenes
 * de esta colección" sin importar cómo tenga configuradas las carpetas la
 * cuenta. El título y la descripción se guardan como "contexto" (metadatos de
 * texto que Cloudinary guarda junto a cada imagen).
 *
 * Este módulo lo usan el servidor (server.js) y el script de migración
 * (scripts/migrar-fotos-locales.js).
 */
import crypto from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';

// Carga las variables del archivo .env (claves de Cloudinary, contraseña…) si
// existe. En el hosting normalmente no hay archivo .env: las variables se
// configuran en su panel, y por eso ignoramos el error si falta.
try {
  process.loadEnvFile();
} catch {
  // Sin archivo .env: se usan las variables de entorno del sistema.
}

// Nombre base de la carpeta y de las etiquetas en Cloudinary.
export const FOLDER = process.env.CLOUDINARY_FOLDER || 'portfolio';
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
 * Construye la dirección web de una imagen con un tamaño máximo dado.
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
function toImage(resource) {
  const context = resource.context?.custom || {};
  return {
    id: resource.asset_id, // identificador único y sin barras, cómodo para las URLs de la API
    publicId: resource.public_id, // nombre interno en Cloudinary; lo usa solo el servidor
    title: context.title || '',
    description: context.description || '',
    cover: (resource.tags || []).includes(COVER_TAG),
    createdAt: resource.created_at,
    thumb: imageUrl(resource, 900), // versión mediana para la galería y las tarjetas
    full: imageUrl(resource, 2000), // versión grande para el visor y la portada
  };
}

// ---------------------------------------------------------------------------
// Operaciones básicas con Cloudinary (las usan todas las colecciones)
// ---------------------------------------------------------------------------

/** Descarga todas las imágenes que tienen una etiqueta, con sus datos. */
async function listByTag(tag) {
  const resources = [];
  let cursor;
  // Cloudinary devuelve los resultados por páginas de hasta 500 elementos;
  // "next_cursor" indica que quedan más páginas por pedir.
  do {
    const page = await cloudinary.api.resources_by_tag(tag, {
      context: true, // incluir título, descripción y demás datos de texto
      tags: true, // incluir etiquetas (para saber cuál es la portada)
      max_results: 500,
      next_cursor: cursor,
    });
    resources.push(...page.resources);
    cursor = page.next_cursor;
  } while (cursor);
  return resources;
}

/**
 * Sube una imagen a partir de su contenido en memoria (un Buffer) y devuelve
 * la respuesta de Cloudinary.
 */
function uploadBuffer(buffer, { folder, tags, context }) {
  // La librería de Cloudinary sube los datos en forma de "stream" y avisa con
  // un callback; lo envolvemos en una Promise para poder usar await.
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, tags, context, resource_type: 'image' },
      (error, result) => (error ? reject(error) : resolve(result)),
    );
    stream.end(buffer);
  });
}

/**
 * Borra una imagen. "invalidate" pide a la CDN que olvide las copias
 * guardadas, para que deje de verse cuanto antes.
 */
async function destroy(publicId) {
  const { result } = await cloudinary.uploader.destroy(publicId, { invalidate: true });
  // "not found" significa que ya no existía: para nosotros también es un éxito.
  if (result !== 'ok' && result !== 'not found') {
    throw new Error(`Cloudinary no pudo borrar la imagen (${result})`);
  }
}

// Ordena de la más reciente a la más antigua.
const newestFirst = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);

// ---------------------------------------------------------------------------
// Colecciones de imágenes sueltas (galería y eventos)
// ---------------------------------------------------------------------------

/**
 * Crea las operaciones (listar, subir y borrar) de una colección de imágenes
 * sueltas, identificada por su carpeta y su etiqueta.
 */
function collection({ folder, tag }) {
  return {
    /** Lista completa de la colección, de la más reciente a la más antigua. */
    async list() {
      return (await listByTag(tag)).map(toImage).sort(newestFirst);
    },

    /**
     * Sube una imagen con su título y descripción.
     * "extraTags" permite añadir etiquetas, como la de portada al migrar.
     */
    async upload(buffer, { title = '', description = '' } = {}, extraTags = []) {
      const result = await uploadBuffer(buffer, {
        folder,
        tags: [tag, ...extraTags],
        context: { title, description },
      });
      return toImage(result);
    },

    /** Borra una imagen. */
    async remove(image) {
      await destroy(image.publicId);
    },
  };
}

export const gallery = collection({ folder: FOLDER, tag: FOLDER });
export const events = collection({ folder: `${FOLDER}/eventos`, tag: `${FOLDER}-events` });

// ---------------------------------------------------------------------------
// Shootings: grupos de 5 imágenes (una portada + 4 para el collage)
// ---------------------------------------------------------------------------
// Cloudinary no tiene "álbumes", así que agrupamos las imágenes con datos de
// contexto. Las 5 imágenes de un mismo shooting comparten:
//   - la etiqueta "portfolio-shootings" (para listarlas todas de una vez),
//   - el mismo identificador de grupo en "shooting",
// y cada una indica su papel en "slot": "cover" (portada) o "1" a "4" (collage).
// El título y la descripción se guardan en la imagen de portada.
const SHOOTINGS_FOLDER = `${FOLDER}/shootings`;
const SHOOTINGS_TAG = `${FOLDER}-shootings`;

export const shootings = {
  /**
   * Lista de shootings, del más reciente al más antiguo. Cada uno tiene:
   *   { id, title, description, createdAt, cover: imagen, images: [4 imágenes] }
   */
  async list() {
    const groups = new Map();
    for (const resource of await listByTag(SHOOTINGS_TAG)) {
      const context = resource.context?.custom || {};
      if (!context.shooting) continue; // imagen sin grupo: la ignoramos
      if (!groups.has(context.shooting)) groups.set(context.shooting, { id: context.shooting, images: [] });
      const group = groups.get(context.shooting);
      const image = { ...toImage(resource), slot: context.slot };
      if (context.slot === 'cover') {
        Object.assign(group, {
          title: context.title || '',
          description: context.description || '',
          createdAt: image.createdAt,
          cover: image,
        });
      } else {
        group.images.push(image);
      }
    }

    return [...groups.values()]
      .filter((group) => group.cover) // un grupo sin portada está incompleto
      .map((group) => ({ ...group, images: group.images.sort((a, b) => a.slot - b.slot) }))
      .sort(newestFirst);
  },

  /**
   * Sube un shooting completo: la portada y las 4 imágenes del collage.
   * Las 5 se suben a la vez (en paralelo) para tardar menos. Si alguna falla,
   * borramos las que sí se subieron, para no dejar shootings a medias.
   */
  async upload(coverBuffer, imageBuffers, { title = '', description = '' } = {}) {
    const id = crypto.randomUUID();
    const common = { folder: SHOOTINGS_FOLDER, tags: [SHOOTINGS_TAG] };
    const uploads = [
      uploadBuffer(coverBuffer, { ...common, context: { shooting: id, slot: 'cover', title, description } }),
      ...imageBuffers.map((buffer, i) =>
        uploadBuffer(buffer, { ...common, context: { shooting: id, slot: String(i + 1) } })),
    ];

    const results = await Promise.allSettled(uploads);
    const failed = results.find((r) => r.status === 'rejected');
    if (failed) {
      const uploaded = results.filter((r) => r.status === 'fulfilled').map((r) => r.value.public_id);
      await Promise.allSettled(uploaded.map(destroy));
      throw failed.reason;
    }

    const [cover, ...images] = results.map((r) => toImage(r.value));
    return { id, title, description, createdAt: cover.createdAt, cover, images };
  },

  /** Borra las 5 imágenes de un shooting. */
  async remove(shooting) {
    await Promise.all([shooting.cover, ...shooting.images].map((img) => destroy(img.publicId)));
  },
};

// Etiqueta que se añade al subir una foto que debe ser la portada (usada al migrar).
export const COVER = COVER_TAG;

/**
 * Marca una foto de la galería como portada y se la quita a las demás
 * (solo puede haber una portada a la vez).
 */
export async function setCover(image, allImages) {
  const previous = allImages.filter((img) => img.cover && img.id !== image.id);
  if (previous.length) {
    await cloudinary.uploader.remove_tag(COVER_TAG, previous.map((img) => img.publicId));
  }
  await cloudinary.uploader.add_tag(COVER_TAG, [image.publicId]);
}
