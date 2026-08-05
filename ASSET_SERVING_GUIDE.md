# Asset Serving Guide

This document explains how the frontend should reference backend-hosted assets using full backend URLs. The backend exposes three asset categories with static routes and local storage paths.

## Backend asset endpoints

### 1. Simulation runtime builds

- Route prefix: `/simulations-runtime`
- Example entry URL:
  - `https://api.example.com/simulations-runtime/{simulationUuid}/index.html`
- The frontend should use the exact URL returned by the backend when launching a simulation.
- All nested Unity WebGL asset requests are served under the same prefix, for example:
  - `https://api.example.com/simulations-runtime/{simulationUuid}/Build/Build 002.data.br`
  - `https://api.example.com/simulations-runtime/{simulationUuid}/Build/Build 002.wasm`
  - `https://api.example.com/simulations-runtime/{simulationUuid}/TemplateData/whatever.file`

### 2. Thumbnails

- Route prefix: `/thumbnails`
- Example URL:
  - `https://api.example.com/thumbnails/{filename}`
- Use the full backend origin plus the thumbnail path.
- Thumbnail URLs are typically stored on the backend as `https://api.example.com/thumbnails/{filename}`.

### 3. Lesson files

- Route prefix: `/lesson-files`
- Example URL:
  - `https://api.example.com/lesson-files/{filename}`
- Use the full backend URL when downloading or embedding lesson assets such as PDFs and videos.

## Why use full backend URLs

- The frontend and backend may be hosted on different domains or ports.
- Using full URLs prevents issues with cross-origin requests and static asset resolution.
- The backend defines CORS behavior via `CORS_ORIGIN`, so the frontend must request assets from the backend origin that is allowed by the server.

## Frontend integration recommendations

- Configure a frontend environment variable such as `REACT_APP_API_BASE_URL` or `VITE_API_BASE_URL`.
- Build asset URLs by concatenating the backend origin with the static prefix.

Example:

```js
const apiBase = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';
const thumbnailUrl = `${apiBase}/thumbnails/${thumbnailFilename}`;
const lessonFileUrl = `${apiBase}/lesson-files/${lessonFileName}`;
const simulationEntryUrl = `${apiBase}/simulations-runtime/${simulationUuid}/index.html`;
```

## Simulation launch guidance

- The backend may return a fully qualified simulation entry URL in API responses.
- If your frontend receives only the path, prepend the backend origin explicitly.
- Example launch URL:
  - `https://api.example.com/simulations-runtime/123e4567-e89b-12d3-a456-426614174000/index.html`

## Notes

- The backend stores these assets on the filesystem under the local directories configured by:
  - `SIMULATION_STORAGE_PATH` (default `storage/simulations`)
  - `THUMBNAIL_STORAGE_PATH` (default `storage/thumbnails`)
  - `LESSON_FILES_STORAGE_PATH` (default `storage/lesson-files`)
- These directories are created on backend startup before the server begins listening.
- The frontend should never attempt to resolve backend asset storage paths directly; always use the served URL prefixes above.
