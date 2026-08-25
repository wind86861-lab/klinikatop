import { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import {
  FILE_KINDS,
  MAX_FILE_BYTES,
  assertFileAccess,
  readFile,
  saveFile,
} from '../services/files';

export const filesRouter = Router();

// Rasm base64 shaklida keladi — umumiy 1 MB chegara bu yerda yetmaydi
filesRouter.use(express.json({ limit: `${Math.ceil((MAX_FILE_BYTES * 1.4) / 1024 / 1024)}mb` }));

const uploadSchema = z.object({
  name: z.string().trim().min(1).max(200),
  mimeType: z.string().min(3).max(80),
  kind: z.enum(FILE_KINDS).default('other'),
  label: z.string().trim().max(120).nullable().optional(),
  dataBase64: z.string().min(1),
});

/** Tibbiy hujjat yuklash (UZI, MRT, analiz). */
filesRouter.post('/', (req, res) => {
  const body = uploadSchema.parse(req.body);
  res.status(201).json(
    saveFile({
      ownerId: req.user!.id,
      name: body.name,
      mimeType: body.mimeType,
      kind: body.kind,
      label: body.label ?? null,
      dataBase64: body.dataBase64,
    }),
  );
});

/**
 * Faylni ko'rish. Kirish qat'iy tekshiriladi: egasi, so'rovni olgan klinika
 * yoki moderator. Boshqa hech kim.
 */
filesRouter.get('/:id', (req, res) => {
  const isModerator = req.user!.roles.some((r) => r === 'moderator' || r === 'admin');
  const file = assertFileAccess(req.params.id, req.user!.id, req.user!.clinicId, isModerator);
  const buffer = readFile(file.storagePath);

  res.setHeader('content-type', file.mimeType);
  res.setHeader('content-disposition', `inline; filename="${encodeURIComponent(file.name)}"`);
  // Tibbiy hujjat — oraliq keshlarda qolmasin
  res.setHeader('cache-control', 'private, no-store');
  res.send(buffer);
});
