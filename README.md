# Portafolio

Portafolio web de modelo con galería de fotos, eventos, polaroids, shootings, ficha de medidas, redes sociales y modo claro/oscuro. Incluye un modo de edición protegido por contraseña para subir y borrar fotos, publicar eventos (hojas de portafolio con 1 a 3 fotos, créditos y logo), polaroids (hasta 4 fotos con marco) y shootings (portada + collage de 4 imágenes), y elegir la portada.

Las fotos se guardan en [Cloudinary](https://cloudinary.com), un servicio de imágenes en la nube con plan gratuito. Así las fotos no se pierden al reiniciar o actualizar el hosting, y cada visitante recibe una versión optimizada: más pequeña y en el formato más ligero que admita su navegador.

## Requisitos

- Node.js 21 o superior
- Una cuenta gratuita de Cloudinary

## Puesta en marcha

1. Crea una cuenta en https://cloudinary.com y copia tus claves (*Cloud name*, *API Key* y *API Secret*). Están en la consola, en **Dashboard → API Keys**.
2. Copia el archivo de ejemplo y rellénalo con tus claves y una contraseña:
   ```bash
   cp .env.example .env
   ```
3. Instala las dependencias y arranca el servidor:
   ```bash
   npm install
   npm start
   ```
4. Abre http://localhost:3000. Para subir fotos, pulsa las iniciales de arriba a la izquierda → **Editar** e introduce la contraseña.

Durante el desarrollo, `npm run dev` reinicia el servidor al guardar cambios.

### Migrar las fotos de la versión anterior

Si subiste fotos antes de usar Cloudinary (carpeta `uploads/`), ejecuta **una sola vez**:

```bash
npm run migrar
```

El script conserva títulos, descripciones y portada, y no borra los archivos locales. Cuando compruebes que todo se ve bien, puedes borrar `uploads/` y `data/images.json`.

## Publicar en un hosting

No subas el archivo `.env`. En el panel del hosting, configura las mismas variables que tiene: `ADMIN_PASSWORD`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` y `CLOUDINARY_API_SECRET` (y las de Google si usas Drive). El servidor usa el puerto que indique la variable `PORT`, que normalmente define el hosting.

## Subir fotos desde Google Drive (opcional)

En modo edición, cada zona de subida puede tener un botón **Desde Google Drive**, que abre el selector de archivos de Google para elegir fotos de tu Drive. Las fotos se descargan en el navegador y se suben igual que si las hubieras elegido del computador.

La web solo pide el permiso `drive.file`: puede leer únicamente los archivos que elijas en el selector, nunca el resto de tu Drive.

Para activarlo necesitas tres claves de Google. Son gratuitas y se obtienen una sola vez en [Google Cloud Console](https://console.cloud.google.com):

1. **Crea un proyecto:** en el selector de proyectos de arriba, elige **Proyecto nuevo**, ponle un nombre (por ejemplo, *Portafolio*) y créalo.
2. **Activa dos APIs:** en **APIs y servicios → Biblioteca**, busca y habilita **Google Picker API** y **Google Drive API**.
3. **Configura la pantalla de consentimiento:** en **APIs y servicios → Pantalla de consentimiento de OAuth** (o **Google Auth Platform**), elige tipo **Externo** y rellena el nombre de la app y tu correo. En **Público** (*Audience*), añade tu cuenta de Google como **usuario de prueba**.
4. **Crea el ID de cliente:** en **Credenciales → Crear credenciales → ID de cliente de OAuth**, elige **Aplicación web**. En **Orígenes de JavaScript autorizados** añade `http://localhost:3000` y, cuando la publiques, la dirección de tu web (por ejemplo `https://tuportafolio.com`). Copia el **ID de cliente** → `GOOGLE_CLIENT_ID`.
5. **Crea la clave de API:** en **Credenciales → Crear credenciales → Clave de API**. Copia la clave → `GOOGLE_API_KEY`. Te recomendamos restringirla: en **Restricciones de aplicaciones** elige **Sitios web** y añade las mismas direcciones del paso 4; en **Restricciones de API**, permite solo *Google Picker API*.
6. **Número de proyecto:** en la página de inicio del proyecto (o en **Configuración de IAM y administración**), copia el **Número de proyecto** (solo cifras) → `GOOGLE_APP_ID`.
7. Añade las tres claves a tu `.env` (o al panel del hosting) y reinicia el servidor.

Mientras la app esté en modo de prueba en Google, solo podrán usar el botón las cuentas que añadiste como usuarios de prueba. Para un portafolio personal, basta con la tuya. Si falta alguna de las tres claves, el botón no aparece y todo lo demás funciona igual.

## Personalización

Edita [data/config.json](data/config.json):

| Campo      | Qué es                                                                 |
| ---------- | ---------------------------------------------------------------------- |
| `name`     | Nombre completo (se muestra en dos líneas en la portada)               |
| `tagline`  | Lema sobre el nombre                                                    |
| `location` | Ciudad                                                                  |
| `bio`      | Texto de "Sobre mí"                                                     |
| `email`    | Correo de contacto                                                      |
| `github`   | Enlace del botón flotante de GitHub (bórralo para ocultar el botón)     |
| `stats`    | Medidas; puedes añadir o quitar las que quieras                         |
| `social`   | Redes sociales. Tienen icono: Instagram, Facebook, X y TikTok           |

Cada evento se muestra como una hoja de portafolio: cabecera con el nombre, «Portfolio» y el año; logo del evento (opcional); título, fecha y detalle; hasta 3 columnas de créditos (p. ej. diseñador / marca, accesorios, bolsos); una descripción opcional; y abajo de **1 a 3 fotos** una al lado de otra, cada una con su leyenda y el lugar donde se tomó.

En modo edición, la sección **Eventos** muestra el botón **+ Añadir evento**, y cada hoja tiene los botones **Editar** (textos, créditos, leyendas, quitar o añadir fotos y cambiar o quitar el logo) y **Eliminar**. Si no hay eventos, los visitantes ven el aviso «No hay eventos registrados». Cada foto (de los eventos, las polaroids y la foto principal) tiene el botón **Ajustar encuadre** en modo edición, para arrastrarla y elegir qué parte se ve, y acercarla con el zoom (barra deslizante o rueda del ratón, hasta 3×).

En modo edición, las fotos de la galería tienen un botón con un **lápiz** (junto a la ×) para cambiar su título y descripción después de publicarlos. El shooting se edita con su propio botón **Editar** (título, subtítulo y descripción).

La sección **Polaroids** muestra hasta 4 fotos con marco negro en una cuadrícula de 2 × 2. En modo edición, los huecos libres aparecen como marcos punteados: al pulsarlos (o **+ Añadir polaroids**) se pueden subir las que falten, una o varias a la vez, desde el computador o Google Drive. Cada polaroid tiene los botones **×** (borrar) y **Ajustar encuadre**. Para cambiar el orden, arrastra una polaroid encima de otra o usa las flechas **‹ ›** de su esquina; el orden se guarda al momento.

La sección **Shootings** admite **un solo shooting** a la vez (para publicar otro hay que borrar el actual). Lleva título, subtítulo (opcional), descripción, una portada y un collage en **páginas de 4 imágenes**: al publicarlo se eligen 4, 8, 12… imágenes (hasta 20 de una vez) y cada 4 forman una página. Se muestra centrado con forma de revista: la portada lleva "SHOOTING" como cabecera y el subtítulo y el título como titular, y con las flechas (o deslizando en el móvil) se pasa por las páginas 02, 03… En modo edición, **Editar** permite cambiar los textos y la portada y **añadir páginas** nuevas al final (hasta 10 en total), y cada página tiene el botón **Quitar página** (siempre queda al menos una). Al editar también aparece el **organizador del collage**: se pueden arrastrar las imágenes (o moverlas con ‹ ›) para cambiar su orden o pasarlas a otra página, quitar imágenes sueltas y crear páginas vacías. Para guardar, cada página debe tener exactamente 4 imágenes; si no, se muestra un aviso con las páginas que no cumplen.

La portada es la foto marcada con **Usar como portada** en modo edición. Si no marcas ninguna, se usa la foto más antigua. En modo edición, el botón **Ajustar encuadre** de la foto principal permite arrastrarla para elegir qué parte se ve (al elegir una nueva portada se abre automáticamente); el encuadre se guarda en Cloudinary.

## Estructura

```
server.js                      Servidor Express y API
lib/cloudinary.js              Conexión con Cloudinary (galería, eventos, polaroids y shootings)
scripts/migrar-fotos-locales.js  Pasa las fotos locales antiguas a Cloudinary
data/config.json               Datos del perfil
public/                        Página web (HTML, CSS y JavaScript)
.env.example                   Plantilla de variables de entorno
```

## API

| Método | Ruta                    | Descripción                                |
| ------ | ----------------------- | ------------------------------------------ |
| GET    | /api/config             | Datos del perfil                           |
| GET    | /api/images             | Lista de fotos                             |
| POST   | /api/login              | Comprueba la contraseña                    |
| POST   | /api/images             | Sube una foto (requiere contraseña)        |
| PUT    | /api/images/:id         | Edita el título y la descripción, JSON `{ title, description }` (requiere contraseña) |
| PUT    | /api/images/:id/cover   | La marca como portada (requiere contraseña) |
| PUT    | /api/images/:id/focus   | Guarda su encuadre en la portada, JSON `{ x, y, zoom }` (x e y en %, zoom de 1 a 3) (requiere contraseña) |
| GET    | /api/events             | Lista de eventos (fotos con leyenda, logo, textos y créditos) |
| POST   | /api/events             | Publica un evento: `images` (1 a 3), `legend0`/`place0`…, `logo` opcional, `title` (obligatorio), `date`, `detail`, `description`, `credit1Label`/`credit1Value`… (requiere contraseña) |
| PUT    | /api/events/:id         | Edita un evento: los mismos campos, más `keep` (JSON con las fotos que se conservan y su leyenda) y `removeLogo` (requiere contraseña) |
| DELETE | /api/events/:id         | Borra un evento con todas sus imágenes (requiere contraseña) |
| PUT    | /api/events/:id/images/:imageId/focus | Guarda el encuadre de una foto, JSON `{ x, y, zoom }` (requiere contraseña) |
| GET    | /api/polaroids          | Lista de polaroids (4 como máximo)         |
| POST   | /api/polaroids          | Sube una o varias en el campo `image`, hasta completar 4 (requiere contraseña) |
| DELETE | /api/polaroids/:id      | Borra una polaroid (requiere contraseña)   |
| PUT    | /api/polaroids/order    | Cambia el orden, JSON `{ ids: [...] }` con todos los ids en el orden nuevo (requiere contraseña) |
| PUT    | /api/polaroids/:id/focus| Guarda el encuadre de la foto, JSON `{ x, y, zoom }` (x e y en %, zoom de 1 a 3) (requiere contraseña) |
| GET    | /api/shootings          | Lista de shootings                         |
| POST   | /api/shootings          | Publica el shooting (solo se permite uno): `cover` (1 imagen), `images` (4, 8, 12… hasta 20), `title`, `subtitle` y `description` (requiere contraseña) |
| PUT    | /api/shootings/:id      | Edita el shooting: textos, `cover` (opcional), `images` (4, 8, 12…: se añaden como páginas nuevas) y `order` (JSON con los ids de las imágenes actuales en su nuevo orden; las que faltan se quitan) (requiere contraseña) |
| DELETE | /api/shootings/:id/pages/:n | Quita la página n del collage (requiere contraseña; debe quedar al menos una) |
| DELETE | /api/shootings/:id      | Borra el shooting con todas sus imágenes (requiere contraseña) |
| DELETE | /api/images/:id         | La borra (requiere contraseña)             |

Las rutas protegidas esperan la cabecera `x-admin-password`. Formatos aceptados: JPG, PNG, WEBP y GIF, de hasta 10 MB.
