# Portafolio

Aplicación web para mostrar una galería de imágenes y tus redes sociales, con un modo de edición protegido por contraseña para subir y eliminar imágenes.

## Requisitos

- Node.js 20 o superior

## Uso

```bash
npm install
ADMIN_PASSWORD="tu-contraseña" npm start
```

Abre http://localhost:3000. Para subir imágenes pulsa **Modo edición** e introduce la contraseña.

Si no defines `ADMIN_PASSWORD`, la contraseña por defecto es `admin` (cámbiala antes de publicar el sitio).

Durante el desarrollo, `npm run dev` reinicia el servidor al guardar cambios.

## Personalización

Edita [data/config.json](data/config.json) para cambiar tu nombre, lema (`tagline`), ciudad (`location`), biografía, correo de contacto, enlace al repositorio de GitHub (`github`, se muestra como botón flotante abajo a la derecha; bórralo para ocultarlo), medidas (`stats`, puedes añadir o quitar las que quieras) y redes sociales. La primera foto que subas se usa como portada. Las redes con icono incluido son: Instagram, Facebook, X y TikTok (cualquier otra se muestra solo con el nombre).

## Estructura

```
server.js          Servidor Express y API
data/config.json   Nombre, bio y redes sociales
data/images.json   Lista de imágenes (se crea automáticamente)
uploads/           Archivos de imagen subidos
public/            Frontend (HTML, CSS, JS)
```

## API

| Método | Ruta              | Descripción                          |
| ------ | ----------------- | ------------------------------------ |
| GET    | /api/config       | Datos del perfil y redes sociales    |
| GET    | /api/images       | Lista de imágenes                    |
| POST   | /api/images       | Sube una imagen (requiere contraseña) |
| DELETE | /api/images/:id   | Elimina una imagen (requiere contraseña) |

Las rutas protegidas esperan la cabecera `x-admin-password`. Formatos aceptados: JPG, PNG, WEBP y GIF, hasta 10 MB.
