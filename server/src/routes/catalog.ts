import { Router } from 'express';
import {
  catalogTree,
  listCategories,
  listCities,
  listOperations,
  searchOperations,
  getOperation,
  getUnknownOperation,
} from '../services/catalog';
import { getPriceStats } from '../services/priceStats';
import { listClinicReviews } from '../services/reviews';
import { getClinicPublic } from '../services/clinics';
import { countMatchingClinics } from '../services/matching';
import { getPricePulse, getTestimonials } from '../services/highlights';
import { resolveUser } from '../middleware/auth';

export const catalogRouter = Router();

catalogRouter.get('/cities', (_req, res) => res.json(listCities()));
catalogRouter.get('/categories', (_req, res) => res.json(listCategories()));

/**
 * Katalog daraxti — soha → bo'lim → operatsiya.
 *
 * Bemor ham, klinika ham shu bitta manbadan foydalanadi: ikki joyda
 * ikki xil tuzilma bo'lsa, ular bir-biriga mos kelmay qoladi.
 */
catalogRouter.get('/tree', (_req, res) => res.json(catalogTree()));

catalogRouter.get('/operations', (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
  if (q) return res.json(searchOperations(q));
  res.json(listOperations(categoryId));
});

/** "Bilmayman" varianti — vizardning 1-qadami uchun. */
catalogRouter.get('/unknown-operation', (_req, res) => {
  res.json(getUnknownOperation());
});

catalogRouter.get('/operations/:id', (req, res) => {
  res.json(getOperation(Number(req.params.id)));
});

/** Byudjet ekrani: narx statistikasi + shu yo'nalishda nechta klinika bor. */
catalogRouter.get('/price-stats', (req, res) => {
  const operationId = Number(req.query.operationId);
  const cityId = Number(req.query.cityId);
  if (!operationId || !cityId) {
    return res.status(400).json({ error: 'operationId va cityId kerak', code: 'bad_query' });
  }
  res.json({
    stats: getPriceStats(operationId, cityId),
    matchingClinics: countMatchingClinics(operationId, cityId),
  });
});

catalogRouter.get('/clinics/:id', (req, res) => {
  const id = Number(req.params.id);
  res.json({ clinic: getClinicPublic(id), reviews: listClinicReviews(id) });
});

/**
 * Bosh sahifa uchun jonli kontent: narx pulsi + bemorlar fikri.
 * Ochiq marshrut — lekin foydalanuvchi bo'lsa uning viloyati va tili hisobga olinadi.
 */
catalogRouter.get('/highlights', (req, res) => {
  const user = resolveUser(req);
  const lang = user?.lang ?? (String(req.query.lang) === 'ru' ? 'ru' : 'uz');
  const cityId = user?.cityId ?? (req.query.cityId ? Number(req.query.cityId) : null);

  res.json({
    pulse: getPricePulse(cityId, lang),
    testimonials: getTestimonials(8, lang),
  });
});
