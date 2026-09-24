import { Router } from 'express';
import { listUsers, createUser, updateUser, setUserScopes } from './controller.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';

const router = Router();

router.use(requireAuth);
router.use(requireRole('ADMIN'));

router.get('/', asyncHandler(listUsers));
router.post('/', asyncHandler(createUser));
router.patch('/:id', asyncHandler(updateUser));
router.put('/:id/scopes', asyncHandler(setUserScopes));

export default router;
