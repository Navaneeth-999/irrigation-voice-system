import { Router } from 'express';
import express from 'express';
import { TelephonyController } from './controller.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';

export const telephonyRouter = Router();

// Protected API routes
telephonyRouter.post('/simulator/start', requireAuth, TelephonyController.startSimulatorCall);
telephonyRouter.post('/simulator/dtmf', requireAuth, TelephonyController.simulatorDtmf);
telephonyRouter.post('/simulator/timeout', requireAuth, TelephonyController.simulatorTimeout);

telephonyRouter.post('/call/live', requireAuth, requireRole('ADMIN', 'CSP_MEMBER'), TelephonyController.startLiveCall);
telephonyRouter.get('/logs', requireAuth, TelephonyController.listCallLogs);
telephonyRouter.get('/farmers/:farmerId/history', requireAuth, TelephonyController.getFarmerCommunications);
telephonyRouter.get('/attempts/:id', requireAuth, TelephonyController.getCallAttemptDetails);

telephonyRouter.get('/schedules', requireAuth, TelephonyController.listSchedules);
telephonyRouter.post('/schedule/process-due', requireAuth, requireRole('ADMIN', 'CSP_MEMBER'), TelephonyController.processDueQueue);

telephonyRouter.get('/prompts', requireAuth, TelephonyController.listPrompts);
telephonyRouter.post('/prompts/:promptCode/review', requireAuth, requireRole('ADMIN', 'CSP_MEMBER'), TelephonyController.reviewPrompt);

// Twilio Webhook Router (Public endpoints with signature verification)
export const twilioWebhookRouter = Router();

// Twilio webhook payloads are typically application/x-www-form-urlencoded
twilioWebhookRouter.use(express.urlencoded({ extended: true }));
twilioWebhookRouter.post('/voice', TelephonyController.handleTwilioVoice);
twilioWebhookRouter.post('/status', TelephonyController.handleTwilioStatus);
