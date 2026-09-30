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
 * Hay cuatro "colecciones" de imágenes, que no se mezclan entre sí:
 *   - gallery: las fotos del portafolio.
 *       carpeta "portfolio", etiqueta "portfolio".
 *       La foto de portada lleva además la etiqueta "portfolio-cover".
 *   - events: los eventos (de 1 a 3 fotos con leyenda, logo opcional, título,
 *       fecha, detalle, descripción y créditos).
 *       carpeta "portfolio/eventos", etiqueta "portfolio-events".
 *   - polaroids: hasta 4 fotos que se muestran con marco en una cuadrícula.
 *       carpeta "portfolio/polaroids", etiqueta "portfolio-polaroids".
 *   - shootings: una portada + páginas de collage de 4 imágenes, con título y
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
    focus: parseFocus(context.focus), // encuadre: { x, y, zoom } o null
    order: context.order === undefined ? null : Number(context.order), // posición (solo polaroids)
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
// Colecciones de imágenes sueltas (galería, eventos y polaroids)
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
    async upload(buffer, { title = '', description = '', order } = {}, extraTags = []) {
      const context = { title, description };
      if (order !== undefined) context.order = String(order); // posición (solo polaroids)
      const result = await uploadBuffer(buffer, { folder, tags: [tag, ...extraTags], context });
      return toImage(result);
    },

    /** Borra una imagen. */
    async remove(image) {
      await destroy(image.publicId);
    },
  };
}

export const gallery = collection({ folder: FOLDER, tag: FOLDER });
export const polaroids = collection({ folder: `${FOLDER}/polaroids`, tag: `${FOLDER}-polaroids` });

// ---------------------------------------------------------------------------
// Shootings: una portada + páginas de collage de 4 imágenes cada una
// ---------------------------------------------------------------------------
// Cloudinary no tiene "álbumes", así que agrupamos las imágenes con datos de
// contexto. Todas las imágenes de un mismo shooting comparten:
//   - la etiqueta "portfolio-shootings" (para listarlas todas de una vez),
//   - el mismo identificador de grupo en "shooting",
// y cada una indica su papel en "slot": "cover" (portada) o un número 1, 2, 3…
// (su posición en el collage; las imágenes 1-4 son la página 1, 5-8 la 2, etc.).
// El título, el subtítulo y la descripción se guardan en la imagen de portada.
const SHOOTINGS_FOLDER = `${FOLDER}/shootings`;
const SHOOTINGS_TAG = `${FOLDER}-shootings`;

/** Sube varias imágenes de un shooting a la vez (ver uploadGroup). */
function uploadShootingImages(jobs) {
  return uploadGroup(jobs, { folder: SHOOTINGS_FOLDER, tag: SHOOTINGS_TAG });
}

/**
 * Sube a la vez varias imágenes de un mismo grupo (un shooting o un evento).
 * Cada tarea es { buffer, context }. Si alguna falla, borra las que sí se
 * subieron, para no dejar imágenes sueltas, y lanza el error.
 * Devuelve las imágenes en el mismo orden que las tareas.
 */
async function uploadGroup(jobs, { folder, tag }) {
  const results = await Promise.allSettled(jobs.map(({ buffer, context }) =>
    uploadBuffer(buffer, { folder, tags: [tag], context })));
  const failed = results.find((r) => r.status === 'rejected');
  if (failed) {
    const uploaded = results.filter((r) => r.status === 'fulfilled').map((r) => r.value.public_id);
    await Promise.allSettled(uploaded.map(destroy));
    throw failed.reason;
  }
  return results.map((r) => toImage(r.value));
}

// Cada página del collage tiene 4 imágenes.
export const PAGE_SIZE = 4;

// Divide la lista de imágenes del collage en páginas de 4.
export const toPages = (images) =>
  Array.from({ length: Math.ceil(images.length / PAGE_SIZE) }, (_, i) => images.slice(i * PAGE_SIZE, (i + 1) * PAGE_SIZE));

export const shootings = {
  /**
   * Lista de shootings, del más reciente al más antiguo. Cada uno tiene:
   *   { id, title, subtitle, description, createdAt, cover: imagen, images: [imágenes del collage] }
   * Las imágenes del collage van en orden ("slot" 1, 2, 3…); cada 4 forman una página.
   */
  async list() {
    const groups = new Map();
    for (const resource of await listByTag(SHOOTINGS_TAG)) {
      const context = resource.context?.custom || {};
      if (!context.shooting) continue; // imagen sin grupo: la ignoramos
      if (!groups.has(context.shooting)) groups.set(context.shooting, { id: context.shooting, images: [] });
      const group = groups.get(context.shooting);
      const image = { ...toImage(resource), slot: Number(context.slot) || context.slot };
      if (context.slot === 'cover') {
        Object.assign(group, {
          title: context.title || '',
          subtitle: context.subtitle || '',
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
   * Sube un shooting completo: la portada y las imágenes del collage
   * (4, 8, 12…: cada 4 forman una página).
   */
  async upload(coverBuffer, imageBuffers, { title = '', subtitle = '', description = '' } = {}) {
    const id = crypto.randomUUID();
    const [cover, ...images] = await uploadShootingImages([
      { buffer: coverBuffer, context: { shooting: id, slot: 'cover', title, subtitle, description } },
      ...imageBuffers.map((buffer, i) => ({ buffer, context: { shooting: id, slot: String(i + 1) } })),
    ]);
    return { id, title, subtitle, description, createdAt: cover.createdAt, cover, images };
  },

  /**
   * Edita un shooting ya publicado.
   *   - title, subtitle, description: los textos nuevos (siempre se envían).
   *   - coverBuffer: portada nueva (opcional; si no se envía, se conserva la actual).
   *   - addImageBuffers: imágenes para añadir al final del collage como páginas
   *     nuevas (opcional; 4, 8, 12…).
   *   - order: las imágenes actuales del collage que se conservan, en su nuevo
   *     orden (opcional; si no se envía, se conserva el orden actual).
   *   - removed: imágenes actuales del collage que se quitan (opcional).
   * Primero se suben las imágenes nuevas y solo al final se borran las que se
   * quitan: así, si algo falla a mitad, no se pierde ninguna imagen.
   * Devuelve el shooting actualizado.
   */
  async update(shooting, {
    title = '', subtitle = '', description = '', coverBuffer, addImageBuffers = [],
    order = shooting.images, removed = [],
  }) {
    const texts = { title, subtitle, description };
    const coverContext = { shooting: shooting.id, slot: 'cover', ...texts };

    // 1. Subir las imágenes nuevas (si las hay). Las del collage continúan la
    //    numeración a partir de la última imagen que ya existe.
    const lastSlot = Math.max(0, ...shooting.images.map((img) => Number(img.slot) || 0));
    const jobs = [];
    if (coverBuffer) jobs.push({ buffer: coverBuffer, context: coverContext });
    addImageBuffers.forEach((buffer, i) =>
      jobs.push({ buffer, context: { shooting: shooting.id, slot: String(lastSlot + i + 1) } }));
    const uploaded = jobs.length ? await uploadShootingImages(jobs) : [];
    const newCover = coverBuffer ? uploaded.shift() : null;
    const added = uploaded.map((img, i) => ({ ...img, slot: lastSlot + i + 1 }));

    // 2. Si la portada se conserva, actualizamos sus textos. Cloudinary no
    //    permite vaciar un dato suelto, así que borramos todos los datos de la
    //    portada y los escribimos de nuevo completos. Si la escritura falla,
    //    restauramos los anteriores para que el shooting no se pierda.
    if (!newCover) {
      const previous = {
        shooting: shooting.id, slot: 'cover',
        title: shooting.title, subtitle: shooting.subtitle, description: shooting.description,
      };
      await cloudinary.uploader.remove_all_context([shooting.cover.publicId]);
      try {
        await cloudinary.uploader.add_context(coverContext, [shooting.cover.publicId]);
      } catch (error) {
        await cloudinary.uploader.add_context(previous, [shooting.cover.publicId]).catch(() => {});
        throw error;
      }
    }

    // 3. Nuevo orden del collage: cada imagen conservada recibe su nueva
    //    posición ("slot" 1, 2, 3…). Solo se actualizan las que cambian de
    //    sitio. "add_context" reemplaza solo el dato "slot" y conserva los demás.
    //    Las imágenes añadidas en el paso 1 tienen números mayores, así que
    //    siguen quedando al final.
    const reordered = order.map((img, i) => ({ ...img, slot: i + 1 }));
    const moved = reordered.filter((img, i) => Number(order[i].slot) !== img.slot);
    await Promise.all(moved.map((img) =>
      cloudinary.uploader.add_context({ slot: String(img.slot) }, [img.publicId])));

    // 4. Borrar la portada antigua (si se cambió) y las imágenes quitadas. Si
    //    alguna no se puede borrar, no detenemos la edición: solo lo anotamos
    //    en la consola del servidor.
    const toDelete = [...(newCover ? [shooting.cover] : []), ...removed];
    const results = await Promise.allSettled(toDelete.map((img) => destroy(img.publicId)));
    results.filter((r) => r.status === 'rejected').forEach((r) => console.error('No se pudo borrar una imagen:', r.reason));

    return {
      ...shooting,
      ...texts,
      cover: newCover || shooting.cover,
      images: [...reordered, ...added],
    };
  },

  /**
   * Quita una página del collage (sus 4 imágenes). "page" empieza en 1.
   * No hace falta renumerar las demás: el orden se mantiene y se vuelven a
   * agrupar de 4 en 4 al mostrarlas. Devuelve el shooting actualizado.
   */
  async removePage(shooting, page) {
    const pageImages = toPages(shooting.images)[page - 1] || [];
    await Promise.all(pageImages.map((img) => destroy(img.publicId)));
    return { ...shooting, images: shooting.images.filter((img) => !pageImages.includes(img)) };
  },

  /** Borra todas las imágenes de un shooting (portada y collage). */
  async remove(shooting) {
    await Promise.all([shooting.cover, ...shooting.images].map((img) => destroy(img.publicId)));
  },
};

// ---------------------------------------------------------------------------
// Eventos: de 1 a 3 fotos (cada una con su leyenda) y un logo opcional
// ---------------------------------------------------------------------------
// Igual que en los shootings, las imágenes de un evento se agrupan con datos
// de contexto:
//   - "event": identificador del evento (el mismo en todas sus imágenes),
//   - "slot": "logo" o la posición de la foto (1, 2, 3),
//   - "legend" y "place": la leyenda de cada foto y dónde se tomó.
// Los textos del evento (título, fecha, créditos…) se copian en TODAS sus
// imágenes: así, si se quita cualquiera de ellas, no se pierden.
// Los eventos publicados antes (una sola imagen, sin "event") se leen como un
// evento con una foto; al editarlos pasan a tener el formato nuevo.
const EVENTS_FOLDER = `${FOLDER}/eventos`;
const EVENTS_TAG = `${FOLDER}-events`;

// Los créditos son 3 columnas con un título y un texto (p. ej. "Accesorios" /
// "Si aplica") y se guardan como c1l / c1v, c2l / c2v, c3l / c3v.
// Convierte los textos del evento (con créditos en lista) en datos planos y al revés.
function eventTexts(event) {
  const flat = { title: event.title, date: event.date, detail: event.detail, description: event.description };
  (event.credits || []).forEach((c, i) => {
    flat[`c${i + 1}l`] = c.label;
    flat[`c${i + 1}v`] = c.value;
  });
  return flat;
}
function readEventTexts(context) {
  return {
    title: context.title || '',
    date: context.date || '',
    detail: context.detail || '',
    description: context.description || '',
    credits: [1, 2, 3].map((n) => ({ label: context[`c${n}l`] || '', value: context[`c${n}v`] || '' })),
  };
}

// Datos completos que lleva una imagen del evento.
const eventImageContext = (event, image) => ({
  ...eventTexts(event),
  event: event.id,
  slot: String(image.slot),
  legend: image.legend || '',
  place: image.place || '',
  ...(image.focus && { focus: focusText(image.focus) }),
});

export const events = {
  /**
   * Lista de eventos, del más reciente al más antiguo. Cada uno tiene:
   *   { id, title, date, detail, description, credits: [{ label, value } ×3],
   *     createdAt, logo: imagen o null, images: [fotos con legend y place] }
   */
  async list() {
    const groups = new Map();
    for (const resource of await listByTag(EVENTS_TAG)) {
      const context = resource.context?.custom || {};
      const image = toImage(resource);
      const id = context.event || image.id; // evento antiguo: su propia imagen es el evento
      if (!groups.has(id)) groups.set(id, { id, images: [], logo: null, createdAt: image.createdAt });
      const group = groups.get(id);
      const slot = context.slot === 'logo' ? 'logo' : Number(context.slot) || 1;
      if (slot === 'logo') group.logo = { ...image, slot };
      else group.images.push({ ...image, slot, legend: context.legend || '', place: context.place || '' });
      // Los textos del evento se toman de la primera foto (o del logo si no hay otra cosa).
      if (!group.texts || (slot !== 'logo' && slot < group.textsSlot)) {
        group.texts = readEventTexts(context);
        group.textsSlot = slot === 'logo' ? Infinity : slot;
      }
      if (new Date(image.createdAt) < new Date(group.createdAt)) group.createdAt = image.createdAt;
    }
    return [...groups.values()]
      .filter((group) => group.images.length > 0) // un evento necesita al menos una foto
      .map(({ texts, textsSlot, ...group }) => ({
        ...group,
        ...texts,
        images: group.images.sort((a, b) => a.slot - b.slot),
      }))
      .sort(newestFirst);
  },

  /**
   * Publica un evento.
   *   texts  → { title, date, detail, description, credits }
   *   photos → [{ buffer, legend, place }] (de 1 a 3)
   *   logoBuffer → logo (opcional)
   */
  async upload(texts, photos, logoBuffer) {
    const event = { id: crypto.randomUUID(), ...texts };
    const jobs = photos.map((p, i) => ({
      buffer: p.buffer,
      context: eventImageContext(event, { slot: i + 1, legend: p.legend, place: p.place }),
    }));
    if (logoBuffer) jobs.push({ buffer: logoBuffer, context: eventImageContext(event, { slot: 'logo' }) });
    const uploaded = await uploadGroup(jobs, { folder: EVENTS_FOLDER, tag: EVENTS_TAG });
    const images = uploaded.slice(0, photos.length).map((img, i) =>
      ({ ...img, slot: i + 1, legend: photos[i].legend, place: photos[i].place }));
    const logo = logoBuffer ? { ...uploaded.at(-1), slot: 'logo' } : null;
    return { ...event, createdAt: images[0].createdAt, images, logo };
  },

  /**
   * Edita un evento.
   *   texts      → los textos nuevos (siempre se envían)
   *   keep       → fotos actuales que se conservan, con su leyenda nueva: [{ image, legend, place }]
   *   add        → fotos nuevas: [{ buffer, legend, place }]
   *   logoBuffer → logo nuevo (opcional); removeLogo → quitar el logo actual
   * Primero se sube lo nuevo y solo al final se borra lo que se quita: así, si
   * algo falla a mitad, no se pierde ninguna imagen. Devuelve el evento actualizado.
   */
  async update(event, { texts, keep, add = [], logoBuffer, removeLogo = false }) {
    const updated = { ...event, ...texts };

    // 1. Subir las fotos nuevas (continúan la numeración) y el logo nuevo.
    const lastSlot = Math.max(0, ...event.images.map((img) => img.slot));
    const jobs = add.map((p, i) => ({
      buffer: p.buffer,
      context: eventImageContext(updated, { slot: lastSlot + i + 1, legend: p.legend, place: p.place }),
    }));
    if (logoBuffer) jobs.push({ buffer: logoBuffer, context: eventImageContext(updated, { slot: 'logo' }) });
    const uploaded = jobs.length ? await uploadGroup(jobs, { folder: EVENTS_FOLDER, tag: EVENTS_TAG }) : [];
    const added = uploaded.slice(0, add.length).map((img, i) =>
      ({ ...img, slot: lastSlot + i + 1, legend: add[i].legend, place: add[i].place }));
    const newLogo = logoBuffer ? { ...uploaded.at(-1), slot: 'logo' } : null;

    // 2. Reescribir los datos de las imágenes que se conservan (textos nuevos y leyendas).
    const kept = keep.map(({ image, legend, place }) => ({ ...image, legend, place }));
    const keepLogo = event.logo && !newLogo && !removeLogo;
    const rewrites = kept.map((img, i) =>
      rewriteContext(img.publicId, eventImageContext(updated, img), eventImageContext(event, keep[i].image)));
    if (keepLogo) {
      rewrites.push(rewriteContext(event.logo.publicId, eventImageContext(updated, event.logo), eventImageContext(event, event.logo)));
    }
    await Promise.all(rewrites);

    // 3. Borrar las fotos quitadas y el logo anterior (si se cambió o se quitó).
    //    Si alguna no se puede borrar, solo lo anotamos en la consola.
    const toDelete = event.images.filter((img) => !kept.some((k) => k.id === img.id));
    if (event.logo && !keepLogo) toDelete.push(event.logo);
    const results = await Promise.allSettled(toDelete.map((img) => destroy(img.publicId)));
    results.filter((r) => r.status === 'rejected').forEach((r) => console.error('No se pudo borrar una imagen:', r.reason));

    return {
      ...updated,
      images: [...kept, ...added].sort((a, b) => a.slot - b.slot),
      logo: newLogo || (keepLogo ? event.logo : null),
    };
  },

  /** Borra todas las imágenes de un evento (fotos y logo). */
  async remove(event) {
    await Promise.all([...event.images, ...(event.logo ? [event.logo] : [])].map((img) => destroy(img.publicId)));
  },
};

// Etiqueta que se añade al subir una foto que debe ser la portada (usada al migrar).
export const COVER = COVER_TAG;

/**
 * Encuadre de una foto dentro de su marco (foto principal, evento o polaroid).
 * Se guarda como el dato de texto "focus" = "x,y,zoom":
 *   x, y → porcentajes (0 a 100) del punto de la foto que queda centrado
 *          (0,0 = esquina superior izquierda)
 *   zoom → cuánto se amplía la foto (1 = tamaño normal, 3 = el triple)
 * Las fotos encuadradas antes de existir el zoom solo tienen "x,y": para
 * ellas el zoom es 1.
 */
function parseFocus(text) {
  const [x, y, zoom = 1] = String(text || '').split(',').map(Number);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(zoom) ? { x, y, zoom } : null;
}

/**
 * Guarda el encuadre de una foto. "add_context" añade o reemplaza solo el dato
 * "focus" y conserva los demás (título y descripción).
 */
export async function setFocus(image, { x, y, zoom }) {
  await cloudinary.uploader.add_context({ focus: focusText({ x, y, zoom }) }, [image.publicId]);
}

/**
 * Guarda el orden de una colección (lo usan las polaroids). Cada imagen lleva
 * su posición en el dato "order" (0, 1, 2…). Solo se actualizan las que
 * cambian de sitio, para hacer las menos peticiones posibles a Cloudinary.
 */
export async function setOrder(images) {
  const moved = images.filter((img, i) => img.order !== i);
  await Promise.all(moved.map((img) =>
    cloudinary.uploader.add_context({ order: String(images.indexOf(img)) }, [img.publicId])));
}

/**
 * Cambia el título y la descripción de una foto o un evento. "add_context"
 * reemplaza solo esos dos datos y conserva los demás (encuadre, etc.). La
 * librería de Cloudinary se encarga de "escapar" los caracteres especiales
 * (como = o |) que pueda tener el texto.
 */
export async function setTexts(image, { title, description }) {
  // Cloudinary no permite vaciar un dato suelto, así que reescribimos todos
  // los datos de la imagen (conservando su encuadre y su posición).
  const keep = {
    ...(image.focus && { focus: focusText(image.focus) }),
    ...(image.order != null && { order: String(image.order) }),
  };
  await rewriteContext(image.publicId,
    { ...keep, title, description },
    { ...keep, title: image.title, description: image.description });
}

// Texto con el que se guarda un encuadre: "x,y,zoom".
const focusText = ({ x, y, zoom = 1 }) => `${x},${y},${zoom}`;

/**
 * Reemplaza TODOS los datos de texto (contexto) de una imagen. Cloudinary no
 * permite vaciar un dato suelto, así que se borran todos y se escriben de
 * nuevo. Si la escritura falla, se restauran los anteriores ("previous").
 * Los datos vacíos no se escriben: así quedan borrados.
 */
async function rewriteContext(publicId, context, previous) {
  const nonEmpty = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '' && v != null));
  await cloudinary.uploader.remove_all_context([publicId]);
  try {
    await cloudinary.uploader.add_context(nonEmpty(context), [publicId]);
  } catch (error) {
    await cloudinary.uploader.add_context(nonEmpty(previous), [publicId]).catch(() => {});
    throw error;
  }
}

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
