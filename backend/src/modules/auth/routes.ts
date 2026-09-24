import { Router } from 'express';
import { login, logout, getCurrentUser } from './controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';

const router = Router();

router.post('/login', asyncHandler(login));
router.post('/logout', asyncHandler(logout));
router.get('/me', requireAuth, asyncHandler(getCurrentUser));

export default router;
