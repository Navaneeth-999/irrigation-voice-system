import { Router } from 'express';
import { login, logout, getCurrentUser, changePassword } from './controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';

const router = Router();

router.post('/login', asyncHandler(login));
router.post('/logout', asyncHandler(logout));
router.get('/me', requireAuth, asyncHandler(getCurrentUser));
router.post('/change-password', requireAuth, asyncHandler(changePassword));

export default router;
